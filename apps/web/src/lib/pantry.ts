/**
 * 冷蔵庫（使い切りリスト）の読み書き（docs/pantry.md）。
 *
 * 数量は持たず「ある / ない」だけを持つ。厳密な在庫管理をしないのが方針で、
 * ズレても献立の加点が少し変わるだけで、買い物リストや献立は壊れない。
 *
 * 行の `id` は食材マスタの `id` と同じ。同じ食材は 1 行しか存在せず、二人が同時に
 * 同じ食材を入れても id が一致するので同期が衝突しない。
 */

import { db, type PantryItemRow } from "../db/schema.ts";
import { enqueue } from "./outbox.ts";
import { flushSoon } from "./outboxSync.ts";

/** 冷蔵庫に入れる。既に入っていれば何もしない（追加日時を上書きしない）。 */
export async function addToPantry(ingredientId: string): Promise<void> {
  const existing = await db.pantryItems.get(ingredientId);
  if (existing) return;
  await db.pantryItems.put({ id: ingredientId, added_at: new Date().toISOString() });
  await enqueue("pantryItems", ingredientId, "put");
  flushSoon();
}

/** 冷蔵庫から出す。入っていなければ何もしない。 */
export async function removeFromPantry(ingredientId: string): Promise<void> {
  const existing = await db.pantryItems.get(ingredientId);
  if (!existing) return;
  await db.pantryItems.delete(ingredientId);
  await enqueue("pantryItems", ingredientId, "delete");
  flushSoon();
}

/** 買い物リストのチェックに追従する（チェック＝入れる、外す＝出す。対称にする）。 */
export async function syncPantryWithCheck(
  ingredientId: string | null,
  isChecked: boolean,
): Promise<void> {
  // 食材マスタに紐付いていない項目（トイレットペーパー等）は冷蔵庫の対象外。
  if (ingredientId === null) return;
  if (isChecked) await addToPantry(ingredientId);
  else await removeFromPantry(ingredientId);
}

/** 冷蔵庫に入っている食材 ID の集合（買い物リストの表示フィルタ用）。 */
export async function pantryIngredientIdSet(): Promise<Set<string>> {
  const rows = await db.pantryItems.toArray();
  return new Set(rows.map((row) => row.id));
}

/** 冷蔵庫の中身（食材マスタと突き合わせた表示用）。 */
export interface PantryEntry {
  item: PantryItemRow;
  /** 食材名。マスタが消えていれば null（統合や削除の直後など）。 */
  name: string | null;
  category: string | null;
}

/**
 * 冷蔵庫の中身を売場カテゴリ順・名前順で返す。
 *
 * マスタが見つからない行は末尾に置く（食材マスタの統合直後などに一瞬起きうる）。
 */
export async function listPantry(): Promise<PantryEntry[]> {
  const [items, masters] = await Promise.all([
    db.pantryItems.toArray(),
    db.ingredients.toArray(),
  ]);
  const byId = new Map(masters.map((m) => [m.id, m] as const));
  return items
    .map<PantryEntry>((item) => {
      const master = byId.get(item.id);
      return { item, name: master?.canonical_name ?? null, category: master?.category ?? null };
    })
    .sort((a, b) => {
      if (a.name === null) return 1;
      if (b.name === null) return -1;
      return (a.category ?? "").localeCompare(b.category ?? "") ||
        a.name.localeCompare(b.name, "ja");
    });
}
