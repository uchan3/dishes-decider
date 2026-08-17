/**
 * 送信キューの Supabase 側の実装と、フラッシュのスケジューリング。
 *
 * キューの中身（{@link flushOutbox}）はテスト可能に切り離してあり、ここは
 * 「Supabase にどう書くか」「いつ流すか」だけを持つ。
 */

import { supabase, isSupabaseConfigured } from "./supabase.ts";
import { db } from "../db/schema.ts";
import { isUuid } from "./ids.ts";
import {
  backoffDelayMs,
  flushOutbox,
  SYNC_TABLES,
  type FlushResult,
  type OutboxSender,
  type RowLoader,
  type SyncTable,
} from "./outbox.ts";
import { buildPlanDocument, pushPlanDocument, type PlanDocument } from "./planSync.ts";

/** `user_id` 列を持つテーブル（挿入時に所有者を明示しないと RLS で弾かれる）。 */
const OWNED_TABLES: ReadonlySet<SyncTable> = new Set<SyncTable>([
  "recipes",
  "ingredients",
  "sources",
]);

/**
 * 送信対象の読み出し。週ドキュメントだけは Dexie の 1 行ではなく組み立てて渡し、
 * それ以外は同名テーブルから 1 行取る。
 */
const loadRow: RowLoader = async (table, id) => {
  if (table === "planDocs") {
    const doc = await buildPlanDocument(id);
    return doc === null ? undefined : (doc as unknown as Record<string, unknown>);
  }
  return (await db.table(table).get(id)) as Record<string, unknown> | undefined;
};

/** Supabase へ upsert / delete する送信実装。 */
export function supabaseSender(userId: string): OutboxSender {
  return {
    async put(table, row) {
      if (table === "planDocs") {
        await pushPlanDocument(userId, row as unknown as PlanDocument);
        return;
      }
      const payload: Record<string, unknown> = OWNED_TABLES.has(table)
        ? { ...row, user_id: userId }
        : { ...row };
      // ローカル専用ソース（`src-manual` 等）は Supabase に存在しない。uuid 型に入らず
      // 送信が永久に失敗するため、参照を落として送る（レシピ自体は同期される）。
      if (table === "recipes" && typeof payload.source_id === "string") {
        if (!isUuid(payload.source_id)) payload.source_id = null;
      }
      const { error } = await supabase.from(SYNC_TABLES[table]).upsert(payload);
      if (error) throw new Error(`${SYNC_TABLES[table]} の送信に失敗: ${error.message}`);
    },
    async remove(table, id) {
      // 週ドキュメントは削除しない（献立を消す導線が無く、作り直しは put で上書きされる）。
      if (table === "planDocs") return;
      const { error } = await supabase.from(SYNC_TABLES[table]).delete().eq("id", id);
      if (error) throw new Error(`${SYNC_TABLES[table]} の削除に失敗: ${error.message}`);
    },
  };
}

/** 現在ログイン中のユーザー ID。ログイン時に {@link startOutboxSync} が設定する。 */
let currentUserId: string | null = null;

/**
 * キューを今すぐ流す。未ログイン・Supabase 未設定なら何もしない。
 *
 * 書き込み操作の直後に「ついでに送る」ためにも使う（成功しなくてもキューに残るだけ）。
 */
export async function flushNow(): Promise<FlushResult> {
  if (!isSupabaseConfigured || currentUserId === null) {
    return { sent: 0, remaining: 0, stoppedBy: "not-signed-in" };
  }
  return flushOutbox(supabaseSender(currentUserId), () => navigator.onLine, loadRow);
}

/** 書き込み直後に呼ぶ「ついで送信」。失敗は握りつぶす（キューに残るので後で送られる）。 */
export function flushSoon(): void {
  void flushNow().catch(() => {});
}

/**
 * 送信ループを開始する。
 *
 * 起点は 3 つ: 開始時 / `online` イベント / 失敗後の指数バックオフ。
 * ポーリングはしない（キューが空なら何も起きない）。
 *
 * @returns 停止関数
 */
export function startOutboxSync(userId: string): () => void {
  currentUserId = userId;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = (delay: number) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void run(), delay);
  };

  const run = async (): Promise<void> => {
    if (stopped) return;
    const result = await flushNow();
    if (result.remaining > 0 && result.stoppedBy !== null) {
      // オフラインなら online イベントで起こされるので、待ち時間を長めに取る。
      schedule(backoffDelayMs(attempt++));
    } else {
      attempt = 0;
    }
  };

  const onOnline = () => {
    attempt = 0;
    void run();
  };

  window.addEventListener("online", onOnline);
  void run();

  return () => {
    stopped = true;
    currentUserId = null;
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("online", onOnline);
  };
}
