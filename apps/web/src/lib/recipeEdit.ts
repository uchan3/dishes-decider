/** レシピ詳細画面からの編集操作（お気に入り・タグ・除外）。 */

import { db, type RecipeRow } from "../db/schema.ts";

/** レシピを部分更新する（updated_at を自動で更新）。 */
export async function updateRecipe(
  id: string,
  patch: Partial<RecipeRow>,
): Promise<void> {
  await db.recipes.update(id, { ...patch, updated_at: new Date().toISOString() });
}

/** カンマ・空白・読点区切りのテキストをタグ配列に正規化する。 */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(/[,、\s]+/).map((t) => t.trim()).filter(Boolean))];
}
