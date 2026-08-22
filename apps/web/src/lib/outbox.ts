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
} as const;

/** 同期対象テーブルの Dexie 側の名前。 */
export type SyncTable = keyof typeof SYNC_TABLES;

/** 送信の向き。`put` は現在の行を upsert、`delete` は削除。 */
export type OutboxOp = OutboxRow["op"];

/**
 * Dexie の 1 行に対応しないテーブル（週ドキュメント）。ID が UUID でなくても積む
 * ＝ `plan-2026-08-17` のような決定的なキーをそのまま使う。
 */
const DOC_TABLES: ReadonlySet<SyncTable> = new Set<SyncTable>(["planDocs"]);

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
  await db.outbox.add({
    table_name: table,
    record_id: recordId,
    op,
    created_at: new Date().toISOString(),
  });
}

/** キューに残っている件数（UI の表示用）。 */
export async function pendingCount(): Promise<number> {
  return db.outbox.count();
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
  const entries = coalesceOutbox(all);
  if (entries.length === 0) return { sent: 0, remaining: 0, stoppedBy: null };
  if (!isOnline()) return { sent: 0, remaining: entries.length, stoppedBy: "offline" };

  let sent = 0;
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
      return {
        sent,
        remaining: entries.length - sent,
        stoppedBy: e instanceof Error ? e.message : String(e),
      };
    }
    // 畳んだ分もまとめて消す（同じ行の古い操作は送る必要がない）。
    await db.outbox
      .where("record_id")
      .equals(entry.record_id)
      .filter((row) => row.table_name === entry.table_name)
      .delete();
    sent++;
  }

  return { sent, remaining: await db.outbox.count(), stoppedBy: null };
}
