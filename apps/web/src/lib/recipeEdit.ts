/**
 * レシピ詳細画面からの編集・削除操作（お気に入り・タグ・除外・削除）。
 *
 * 書き込みは **Dexie が先、Supabase は送信キュー経由**（architecture §5.1）。
 * オフラインでも操作は成功し、オンラインに戻った時点で送られる。
 */

import { db, type RecipeRow } from "../db/schema.ts";
import { enqueue } from "./outbox.ts";
import { flushSoon } from "./outboxSync.ts";

/**
 * レシピを部分更新する。Dexie を更新し、Supabase への反映はキューに積む
 * （キューは ID が UUID の行だけを対象にするので、開発用シードは Dexie 内で完結する）。
 */
export async function updateRecipe(
  id: string,
  patch: Partial<RecipeRow>,
): Promise<void> {
  await db.recipes.update(id, { ...patch, updated_at: new Date().toISOString() });
  await enqueue("recipes", id, "put");
  flushSoon();
}

/**
 * レシピを削除する。Dexie から材料ごと消し、Supabase への削除はキューに積む
 * （Supabase 側は材料が ON DELETE CASCADE、献立スロットは SET NULL で連動する）。
 */
export async function deleteRecipe(id: string): Promise<void> {
  await db.transaction("rw", db.recipes, db.recipeIngredients, async () => {
    await db.recipes.delete(id);
    await db.recipeIngredients.where("recipe_id").equals(id).delete();
  });
  await enqueue("recipes", id, "delete");
  flushSoon();
}

/** カンマ・空白・読点区切りのテキストをタグ配列に正規化する。 */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(/[,、\s]+/).map((t) => t.trim()).filter(Boolean))];
}
