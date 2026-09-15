/**
 * 送信キュー（outbox パターン。architecture §5.1）。
 *
 * これまでの書き戻しは「Supabase に書いてから Dexie に書く」順序だったため、
 * **オフラインだと操作そのものが失敗**していた（買い物中に電波が切れると詰む）。
 * ここでは順序を反転させる:
 *
 *   1. Dexie に書く（UI は即座に反映される）
 *   2. `outbox` に「この行を送る」と積む
 *   3. オンラインになったタイミングでまとめて送る。失敗は指数バックオフで再試行
 *
 * 送るのは**差分ではなく現在の行**（state-based）。同じ行への連続編集は 1 件に畳めるし、
 * 競合は `updated_at` の Last-Write-Wins に自然に収まる（世帯 2 人なら実質競合しない）。
 */

import { db, type OutboxRow } from "../db/schema.ts";
import { isUuid } from "./ids.ts";
import { isSupabaseConfigured } from "./supabase.ts";

/** 同期対象のテーブル（Dexie のテーブル名と Supabase のテーブル名の対応を持つ）。 */
export const SYNC_TABLES = {
  recipes: "recipes",
  recipeIngredients: "recipe_ingredients",
  ingredients: "ingredients",
  sources: "sources",
  pantryItems: "pantry_items",
  /** 週ドキュメント（献立＋買い物リスト）。Dexie の 1 行ではなく組み立てて送る。 */
  planDocs: "meal_plans",
  /** 設定ドキュメント（曜日テンプレ＋生成設定）。1 ユーザー 1 行。 */
  settingsDoc: "user_settings",
} as const;

/** 同期対象テーブルの Dexie 側の名前。 */
export type SyncTable = keyof typeof SYNC_TABLES;

/** 送信の向き。`put` は現在の行を upsert、`delete` は削除。 */
export type OutboxOp = OutboxRow["op"];

/**
 * Dexie の 1 行に対応しないテーブル（週ドキュメント・設定）。ID が UUID でなくても積む
 * ＝ `plan-2026-08-17` や `settings` のような決定的なキーをそのまま使う。
 */
const DOC_TABLES: ReadonlySet<SyncTable> = new Set<SyncTable>(["planDocs", "settingsDoc"]);

/**
 * 送信対象を読み出す関数。既定は Dexie の同名テーブルから 1 行取るだけ。
 * 週ドキュメントのように組み立てが要るものは呼び出し側が差し替える。
 */
export type RowLoader = (
  table: SyncTable,
  id: string,
) => Promise<Record<string, unknown> | undefined>;

const defaultLoader: RowLoader = async (table, id) =>
  (await db.table(table).get(id)) as Record<string, unknown> | undefined;

/**
 * 実際に Supabase へ送る処理。テストで差し替えられるよう関数で受け取る。
 * `put` には Dexie から読み直した現在の行が渡る。
 */
export interface OutboxSender {
  put(table: SyncTable, row: Record<string, unknown>): Promise<void>;
  remove(table: SyncTable, id: string): Promise<void>;
}

/** フラッシュ結果。 */
export interface FlushResult {
  /** 送信に成功した件数。 */
  sent: number;
  /** キューに残った件数。 */
  remaining: number;
  /** 送信を中断した理由（オフライン・エラーなど）。完走したら null。 */
  stoppedBy: string | null;
  /** 恒久エラーとしてキューから外した件数（後続は流している）。 */
  failed: number;
}

/**
 * キューを畳む（純粋関数）。
 *
 * 同じ行に対する複数の操作は**最後の操作だけ**を残す。「チェックを 3 回付け外しした」
 * のような操作を 3 回送らないため。順序は各行の最初の登場順を保つ（先に積まれた変更が
 * 先に送られる＝依存関係のある行を作った順に送れる）。
 */
export function coalesceOutbox(entries: readonly OutboxRow[]): OutboxRow[] {
  const byKey = new Map<string, OutboxRow>();
  for (const entry of entries) {
    const key = `${entry.table_name}:${entry.record_id}`;
    const firstSeq = byKey.get(key)?.seq;
    // 操作は最新のものを採用しつつ、並び順は最初に積まれた位置を維持する。
    byKey.set(key, firstSeq === undefined ? entry : { ...entry, seq: firstSeq });
  }
  return [...byKey.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

/**
 * 「何度送っても直らない」と分かっている送信エラー。
 *
 * これを投げると、その 1 件だけがキューから外され、**後続は流れ続ける**。
 * 通常の `Error`（通信断・5xx など）はこれまでどおりそこで打ち切り、順序を保ったまま
 * バックオフで再試行する。
 */
export class PermanentSyncError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PermanentSyncError";
  }
}

/**
 * Postgres / PostgREST のエラーコードが「送り直しても同じ」ものかを返す（純粋関数）。
 *
 * **判っているものだけを恒久扱いにする**（知らないコードは通信の綾かもしれないので
 * 再試行に倒す）。誤って恒久と判定すると、その変更は自動では二度と送られない。
 *
 * @example
 * ```ts
 * isPermanentSyncCode("42703"); // → true（列が無い＝ migration 未適用）
 * isPermanentSyncCode("08006"); // → false（接続エラー。待てば直る）
 * ```
 */
export function isPermanentSyncCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return PERMANENT_CODES.has(code.toUpperCase());
}

/** 送り直しても結果が変わらないエラーコード。 */
const PERMANENT_CODES: ReadonlySet<string> = new Set([
  "42703", // undefined_column … migration 未適用
  "42P01", // undefined_table
  "42501", // insufficient_privilege … RLS で弾かれている
  "PGRST204", // スキーマキャッシュに列が無い（PostgREST）
  "PGRST301", // JWT の問題（送り直しても同じ）
  "22P02", // invalid_text_representation … UUID でない値を uuid 列へ
  "23502", // not_null_violation
  "23503", // foreign_key_violation … 参照先が無い
  "23505", // unique_violation … upsert の衝突キーが噛み合っていない
  "23514", // check_violation
]);

/**
 * Supabase のエラーを送信エラーに変換する。恒久的なコードなら
 * {@link PermanentSyncError} にして、キューが詰まらないようにする。
 *
 * @param prefix - 表示用の前置き（例: 「recipes の送信に失敗」）
 */
export function toSyncError(prefix: string, error: { message: string; code?: string }): Error {
  const message = `${prefix}: ${error.message}`;
  return isPermanentSyncCode(error.code)
    ? new PermanentSyncError(message, error.code)
    : new Error(message);
}

/** 再試行の待ち時間（ミリ秒）。指数バックオフ、上限 5 分。 */
export function backoffDelayMs(attempt: number, baseMs = 1000, maxMs = 5 * 60 * 1000): number {
  if (attempt <= 0) return baseMs;
  return Math.min(maxMs, baseMs * 2 ** attempt);
}

/**
 * 行の変更をキューに積む。
 *
 * Supabase に存在しえない行（開発用シードなど ID が UUID でないもの）と、Supabase を
 * 使わないローカル専用モードでは積まない（送り先が無いキューを太らせないため）。
 *
 * @param table - Dexie のテーブル名
 * @param recordId - 行の ID
 * @param op - `put`（現在の行を送る）か `delete`
 */
export async function enqueue(table: SyncTable, recordId: string, op: OutboxOp): Promise<void> {
  if (!isSupabaseConfigured) return;
  if (!DOC_TABLES.has(table) && !isUuid(recordId)) return;
  // 同じ行に新しい変更が来たら、前の失敗は忘れる（内容が変わっていれば通るかもしれず、
  // 直し方としても「もう一度操作する」が一番自然なため）。
  await clearFailed(table, recordId);
  await db.outbox.add({
    table_name: table,
    record_id: recordId,
    op,
    created_at: new Date().toISOString(),
  });
}

/** キューに残っている件数（送信対象のみ。失敗として外したものは数えない）。 */
export async function pendingCount(): Promise<number> {
  const rows = await db.outbox.toArray();
  return coalesceOutbox(rows.filter((row) => !row.failed_at)).length;
}

/** 送れずに外した変更（設定画面に出す）。 */
export async function failedEntries(): Promise<OutboxRow[]> {
  const rows = await db.outbox.toArray();
  return coalesceOutbox(rows.filter((row) => row.failed_at));
}

/** 指定した行の失敗記録を消す（内部用）。 */
async function clearFailed(table: string, recordId: string): Promise<void> {
  const stuck = await db.outbox
    .where("record_id")
    .equals(recordId)
    .filter((row) => row.table_name === table && row.failed_at !== undefined)
    .toArray();
  if (stuck.length > 0) await db.outbox.bulkDelete(stuck.map((row) => row.seq as number));
}

/**
 * 外した変更をもう一度送信対象に戻す。
 *
 * サーバー側を直したあと（migration を当てた等）に設定画面から押す。
 *
 * @returns 戻した件数
 */
export async function retryFailed(): Promise<number> {
  const rows = (await db.outbox.toArray()).filter((row) => row.failed_at);
  await db.outbox.bulkPut(
    rows.map(({ failed_at: _failed, error: _error, ...rest }) => rest as OutboxRow),
  );
  return rows.length;
}

/** 外した変更を捨てる（もう送らなくてよいと判断したとき）。 */
export async function discardFailed(): Promise<number> {
  const rows = (await db.outbox.toArray()).filter((row) => row.failed_at);
  await db.outbox.bulkDelete(rows.map((row) => row.seq as number));
  return rows.length;
}

/**
 * キューを Supabase に流す。
 *
 * 1 件でも失敗したらそこで止める（後続に依存関係があるかもしれないため）。成功した分は
 * キューから消える。オフライン時は何もせず `stoppedBy: "offline"` を返す。
 *
 * @param sender - 送信処理
 * @param isOnline - オンライン判定（既定は `navigator.onLine`）
 */
export async function flushOutbox(
  sender: OutboxSender,
  isOnline: () => boolean = () => navigator.onLine,
  loadRow: RowLoader = defaultLoader,
): Promise<FlushResult> {
  const all = await db.outbox.orderBy("seq").toArray();
  // 恒久エラーで外した行は送信対象に入れない（手動で戻すまで寝かせる）。
  const entries = coalesceOutbox(all.filter((row) => !row.failed_at));
  if (entries.length === 0) return { sent: 0, remaining: 0, stoppedBy: null, failed: 0 };
  if (!isOnline()) {
    return { sent: 0, remaining: entries.length, stoppedBy: "offline", failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const entry of entries) {
    const table = entry.table_name as SyncTable;
    try {
      if (entry.op === "delete") {
        await sender.remove(table, entry.record_id);
      } else {
        const row = await loadRow(table, entry.record_id);
        // Dexie から消えている＝後で delete が積まれている。ここでは送らずに捨てる。
        if (row) await sender.put(table, row);
      }
    } catch (e) {
      // 直らないと分かっている失敗は、その 1 件だけ外して先へ進む。
      // ここで打ち切ると、例えば列が足りない 1 件のせいで買い物リストのチェックまで
      // 永久に送られなくなる。
      if (e instanceof PermanentSyncError) {
        await markFailed(entry, e.message);
        failed++;
        continue;
      }
      return {
        sent,
        remaining: entries.length - sent - failed,
        stoppedBy: e instanceof Error ? e.message : String(e),
        failed,
      };
    }
    // 畳んだ分もまとめて消す（同じ行の古い操作は送る必要がない）。
    await deleteEntryRows(entry);
    sent++;
  }

  return { sent, remaining: await pendingCount(), stoppedBy: null, failed };
}

/** 畳んだ 1 件に対応する Dexie の行をまとめて消す。 */
async function deleteEntryRows(entry: OutboxRow): Promise<void> {
  await db.outbox
    .where("record_id")
    .equals(entry.record_id)
    .filter((row) => row.table_name === entry.table_name && !row.failed_at)
    .delete();
}

/**
 * 1 件を「送れなかったもの」として外す。
 *
 * 同じ行の古い操作は畳まれているので、代表の 1 行だけを理由付きで残し、残りは消す
 * （設定画面に同じ失敗が何件も並ばないように）。
 */
async function markFailed(entry: OutboxRow, error: string): Promise<void> {
  await deleteEntryRows(entry);
  await db.outbox.add({
    table_name: entry.table_name,
    record_id: entry.record_id,
    op: entry.op,
    created_at: entry.created_at,
    failed_at: new Date().toISOString(),
    error,
  });
}
