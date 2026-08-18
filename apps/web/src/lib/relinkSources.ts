/**
 * 既存レシピの収集元を後から割り当てる保守処理（F-01-2 / US-03）。
 *
 * 取り込みパイプラインが `source_id` を埋めるようになる前に取り込んだレシピは、
 * ソースに紐付いていない。その状態では設定画面のソース一覧に出てこず、
 * 「今週はリュウジのみ」のような生成対象の絞り込みも効かない。
 *
 * 原典 URL から機械的に決まる範囲（core の {@link deriveSource}）で割り当てる。
 * YouTube のチャンネルは URL だけでは分からないため、既存分はまとめて「YouTube」になる
 * （チャンネル別に分けたい場合は取り込み直すか、設定画面でソース名を付け直す）。
 */

import { deriveSource } from "@recipe-planner/core";
import { db, type RecipeRow, type SourceRow } from "../db/schema.ts";
import { isSupabaseConfigured } from "./supabase.ts";
import { newId } from "./ids.ts";
import { enqueue } from "./outbox.ts";
import { flushSoon } from "./outboxSync.ts";

/** 割り当ての結果。 */
export interface RelinkSourcesResult {
  /** ソース未設定だったレシピの数。 */
  scanned: number;
  /** 割り当てできたレシピの数。 */
  linked: number;
  /** 新しく作ったソースの数。 */
  created: number;
  /** Supabase への送信キューに積んだか。 */
  queued: boolean;
}

/** ソースの同定キー。Supabase の一意制約 `(user_id, kind, identifier)` と揃える。 */
const sourceKey = (kind: string, identifier: string): string => `${kind}:${identifier}`;

/**
 * `source_id` が null のレシピに収集元を割り当てる。
 *
 * @param userId - ログイン中のユーザー ID。null なら Dexie のみ更新する
 */
export async function relinkSources(userId: string | null): Promise<RelinkSourcesResult> {
  const recipes = await db.recipes.toArray();
  // 原典 URL が無いレシピ（手動登録など）は対象外。
  const pending = recipes.filter((r) => r.source_id === null && r.source_url !== null);
  if (pending.length === 0) {
    return { scanned: 0, linked: 0, created: 0, queued: false };
  }

  const existing = await db.sources.toArray();
  const byKey = new Map(existing.map((s) => [sourceKey(s.kind, s.identifier), s] as const));
  const created: SourceRow[] = [];
  const updated: RecipeRow[] = [];

  for (const recipe of pending) {
    const derived = deriveSource(recipe.source_url as string);
    const key = sourceKey(derived.kind, derived.identifier);
    let source = byKey.get(key);
    if (!source) {
      source = {
        id: newId(),
        name: derived.name,
        kind: derived.kind === "manual" ? "manual" : derived.kind,
        identifier: derived.identifier,
        icon_url: null,
        is_enabled: true,
        created_at: new Date().toISOString(),
      };
      created.push(source);
      byKey.set(key, source);
    }
    updated.push({ ...recipe, source_id: source.id, updated_at: new Date().toISOString() });
  }

  await db.transaction("rw", db.sources, db.recipes, async () => {
    if (created.length > 0) await db.sources.bulkAdd(created);
    await db.recipes.bulkPut(updated);
  });

  // 送信順: ソースを作ってからレシピを送る（外部キーの整合を保つ）。
  for (const source of created) await enqueue("sources", source.id, "put");
  for (const recipe of updated) await enqueue("recipes", recipe.id, "put");
  const queued = isSupabaseConfigured && userId !== null;
  if (queued) flushSoon();

  return { scanned: pending.length, linked: updated.length, created: created.length, queued };
}

/** ソースの表示名を変更する（「YouTube」→「リュウジのバズレシピ」など）。 */
export async function renameSource(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === "") return;
  await db.sources.update(id, { name: trimmed });
  await enqueue("sources", id, "put");
  flushSoon();
}
