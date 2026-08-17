/**
 * 収集元（ソース）の操作（F-01-2 / US-03）。
 *
 * 有効/無効の切り替えは Dexie だけ直すと次回の {@link pullLibrary} で巻き戻るため、
 * 送信キュー経由で Supabase にも反映する（レシピの編集・削除と同じ方針）。
 */

import { db, type SourceRow } from "../db/schema.ts";
import { supabase, isSupabaseConfigured } from "./supabase.ts";
import { enqueue } from "./outbox.ts";
import { flushSoon } from "./outboxSync.ts";

/** Supabase 未接続時に使う、ローカル専用の手動入力ソース。 */
const LOCAL_MANUAL_SOURCE: SourceRow = {
  id: "src-manual",
  name: "手動入力",
  kind: "manual",
  identifier: "manual",
  icon_url: null,
  is_enabled: true,
  created_at: "",
};

/**
 * ソースの有効/無効を切り替える。
 *
 * ローカルにしか無いソース（開発用シード等）はキューに積まれないので Dexie 内で完結する。
 */
export async function setSourceEnabled(id: string, isEnabled: boolean): Promise<void> {
  await db.sources.update(id, { is_enabled: isEnabled });
  await enqueue("sources", id, "put");
  flushSoon();
}

/**
 * 手動入力レシピが属するソースを用意して返す。
 *
 * Supabase 接続時は `(kind, identifier) = ('manual', 'manual')` の行を探し、無ければ作る。
 * その UUID を Dexie 側の ID としても使うことで、同期後に手動レシピの `source_id` が
 * 迷子にならないようにする。未接続時はローカル専用 ID (`src-manual`) を使う。
 *
 * @param userId - ログイン中のユーザー ID。null なら Supabase を使わない
 */
export async function ensureManualSource(userId: string | null): Promise<SourceRow> {
  if (!isSupabaseConfigured || userId === null || !navigator.onLine) {
    return localManualSource();
  }
  try {
    return await remoteManualSource(userId);
  } catch {
    // オフラインや一時的な失敗で登録自体を止めない。ローカル専用ソースで続行する
    // （この場合レシピは source なしで同期される。sender が UUID でない source_id を落とす）。
    return localManualSource();
  }
}

/** ローカル専用の手動入力ソースを用意して返す。 */
async function localManualSource(): Promise<SourceRow> {
  const local = (await db.sources.get(LOCAL_MANUAL_SOURCE.id)) ?? {
    ...LOCAL_MANUAL_SOURCE,
    created_at: new Date().toISOString(),
  };
  await db.sources.put(local);
  return local;
}

/** Supabase 側の手動入力ソースを取得（無ければ作成）して Dexie にも反映する。 */
async function remoteManualSource(userId: string): Promise<SourceRow> {
  const { data: existing, error: findErr } = await supabase
    .from("sources")
    .select("*")
    .eq("kind", "manual")
    .eq("identifier", "manual")
    .maybeSingle();
  if (findErr) throw new Error(`ソースの取得に失敗しました: ${findErr.message}`);

  let row = existing as SourceRow | null;
  if (!row) {
    const { data: inserted, error: insertErr } = await supabase
      .from("sources")
      .insert({
        user_id: userId,
        name: LOCAL_MANUAL_SOURCE.name,
        kind: "manual",
        identifier: "manual",
      })
      .select("*")
      .single();
    if (insertErr) throw new Error(`ソースの作成に失敗しました: ${insertErr.message}`);
    row = inserted as SourceRow;
  }

  await db.sources.put(row);
  return row;
}
