/**
 * 収集元（ソース）の操作（F-01-2 / US-03）。
 *
 * 有効/無効の切り替えは Dexie だけ直すと次回の {@link pullLibrary} で巻き戻るため、
 * Supabase にも同じ変更を書く（レシピの編集・削除と同じ方針）。
 */

import { db, type SourceRow } from "../db/schema.ts";
import { supabase, isSupabaseConfigured } from "./supabase.ts";
import { isUuid } from "./ids.ts";

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
 * ローカルにしか無いソース（開発用シード等）は Supabase 側を触らない。
 */
export async function setSourceEnabled(id: string, isEnabled: boolean): Promise<void> {
  if (isSupabaseConfigured && isUuid(id)) {
    const { error } = await supabase.from("sources").update({ is_enabled: isEnabled }).eq("id", id);
    if (error) throw new Error(`ソースの更新に失敗しました: ${error.message}`);
  }
  await db.sources.update(id, { is_enabled: isEnabled });
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
  if (!isSupabaseConfigured || userId === null) {
    const local = (await db.sources.get(LOCAL_MANUAL_SOURCE.id)) ?? {
      ...LOCAL_MANUAL_SOURCE,
      created_at: new Date().toISOString(),
    };
    await db.sources.put(local);
    return local;
  }

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
