/** レシピ詳細画面からの編集・削除操作（お気に入り・タグ・除外・削除）。 */

import { db, type RecipeRow } from "../db/schema.ts";
import { supabase, isSupabaseConfigured } from "./supabase.ts";
import { isUuid } from "./ids.ts";

/**
 * レシピを部分更新する。Supabase 設定時は Supabase も更新し、次回同期での巻き戻りを防ぐ。
 * ID が UUID でない行（開発用シードなど Supabase に存在しない行）は Dexie のみ更新する。
 */
export async function updateRecipe(
  id: string,
  patch: Partial<RecipeRow>,
): Promise<void> {
  if (isSupabaseConfigured && isUuid(id)) {
    const { error } = await supabase.from("recipes").update(patch).eq("id", id);
    if (error) throw new Error(`更新に失敗しました: ${error.message}`);
  }
  await db.recipes.update(id, { ...patch, updated_at: new Date().toISOString() });
}

/**
 * レシピを削除する。Supabase（材料は ON DELETE CASCADE で連動、献立スロットは
 * SET NULL）と Dexie の両方から消す。Dexie だけ消すと次回プルで復活するため。
 */
export async function deleteRecipe(id: string): Promise<void> {
  if (isSupabaseConfigured && isUuid(id)) {
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    if (error) throw new Error(`削除に失敗しました: ${error.message}`);
  }
  await db.transaction("rw", db.recipes, db.recipeIngredients, async () => {
    await db.recipes.delete(id);
    await db.recipeIngredients.where("recipe_id").equals(id).delete();
  });
}

/** カンマ・空白・読点区切りのテキストをタグ配列に正規化する。 */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(/[,、\s]+/).map((t) => t.trim()).filter(Boolean))];
}
