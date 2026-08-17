/**
 * 買い物リストの永続化（US-09 / F-03-2）。
 *
 * 集約結果（core の {@link aggregateShoppingList}）は献立から毎回計算し直せるが、
 * **チェック状態は計算で復元できない**ため Dexie に保存する。買い出し中に画面を閉じたり
 * 電波が切れたりしてもチェックが消えないことが、この機能の存在意義（オフラインファースト）。
 *
 * 献立を作り直すと項目は入れ替わる。そこで「同じ食材か」を正規化キーで判定し、
 * 残っている項目のチェックは引き継ぐ（=再生成でチェックが全部外れない）。
 *
 * 常備品も含めて保存し、表示側でフィルタする。トグルのたびに行を作り直すと、
 * 常備品を一度隠しただけでチェックが消えてしまうため。
 */

import { classifyIngredient, normalizeIngredientName, type ShoppingItem } from "@recipe-planner/core";
import { db, type MealPlanRow, type ShoppingItemRow } from "../db/schema.ts";
import { buildShoppingItems } from "./planning.ts";
import { newId } from "./ids.ts";

/** 献立 1 週分に対応する買い物リストの ID（1:1 なので献立 ID から決まる）。 */
export const shoppingListId = (planId: string): string => `list-${planId}`;

/**
 * 項目の同一性キー。食材マスタに紐付いていればその ID、無ければ正規化した表示名。
 * 集約側（core）のグルーピングキーと同じ規則にしてある。
 */
function itemKey(ingredientId: string | null, displayName: string): string {
  return ingredientId ?? `name:${normalizeIngredientName(displayName)}`;
}

/** 再構築の結果。 */
export interface ReconcileResult {
  /** 保存する行（既存項目はチェック状態と ID を引き継ぐ）。 */
  rows: ShoppingItemRow[];
  /** 献立から消えたため削除する行の ID。 */
  removedIds: string[];
}

/**
 * 集約結果と既存の保存済み行を突き合わせ、保存すべき行を組み立てる（純粋関数）。
 *
 * - 献立に残っている項目: 既存行の `id` と `is_checked` を引き継ぎ、数量などは新しい値で更新
 * - 献立から消えた項目: 削除（買わなくてよくなったものを残さない）
 * - 手動追加の項目 (`is_manual`): 献立と無関係なので常に残す（US-13 の受け皿）
 *
 * @param planId - 対象の週間献立 ID
 * @param aggregated - core が集約した項目（常備品を含む）
 * @param existing - 保存済みの行
 * @param newId - 新規行の ID を作る関数（テストで決定論にできるよう注入）
 */
export function reconcileShoppingItems(
  planId: string,
  aggregated: readonly ShoppingItem[],
  existing: readonly ShoppingItemRow[],
  newId: () => string,
): ReconcileResult {
  const listId = shoppingListId(planId);
  const generated = existing.filter((row) => !row.is_manual);
  const manual = existing.filter((row) => row.is_manual);

  const byKey = new Map<string, ShoppingItemRow>();
  for (const row of generated) {
    const key = itemKey(row.ingredient_id, row.display_name);
    if (!byKey.has(key)) byKey.set(key, row);
  }

  const keptIds = new Set<string>();
  const rows: ShoppingItemRow[] = aggregated.map((item, index) => {
    const key = itemKey(item.ingredientId, item.displayName);
    const prev = byKey.get(key);
    if (prev) keptIds.add(prev.id);
    return {
      id: prev?.id ?? newId(),
      shopping_list_id: listId,
      meal_plan_id: planId,
      ingredient_id: item.ingredientId,
      display_name: item.displayName,
      quantity: item.quantity,
      unit: item.unit,
      ambiguous_note: item.ambiguousNote,
      category: item.category,
      is_checked: prev?.is_checked ?? false,
      is_manual: false,
      source_recipe_ids: item.sourceRecipeIds,
      position: index,
    };
  });

  // 手動項目は献立由来の項目の後ろに詰める。
  manual.forEach((row, i) => {
    rows.push({ ...row, shopping_list_id: listId, position: aggregated.length + i });
  });

  const removedIds = generated.filter((row) => !keptIds.has(row.id)).map((row) => row.id);
  return { rows, removedIds };
}

/**
 * 献立から買い物リストを組み立て直して Dexie に保存する。
 *
 * 画面を開いたときや献立を作り直したときに呼ぶ。既存項目のチェック状態は保たれる。
 *
 * @param plan - 対象の週間献立
 * @param householdSize - 世帯人数（レシピの基準人数からスケーリングする）
 * @returns 保存後の項目数
 */
export async function syncShoppingList(
  plan: MealPlanRow,
  householdSize: number,
): Promise<number> {
  // 常備品も含めて集約する（表示側で隠す）。
  const aggregated = await buildShoppingItems(plan, householdSize, true);
  const existing = await db.shoppingItems.where("meal_plan_id").equals(plan.id).toArray();
  const { rows, removedIds } = reconcileShoppingItems(
    plan.id,
    aggregated,
    existing,
    () => crypto.randomUUID(),
  );

  await db.transaction("rw", db.shoppingItems, async () => {
    if (removedIds.length > 0) await db.shoppingItems.bulkDelete(removedIds);
    await db.shoppingItems.bulkPut(rows);
  });

  return rows.length;
}

/** 手動追加の入力。 */
export interface ManualItemInput {
  displayName: string;
  quantity: number | null;
  unit: string | null;
}

/**
 * 献立に関係ない品を買い物リストに足す（US-13。牛乳・トイレットペーパー等）。
 *
 * 売場カテゴリは取り込みと同じ {@link classifyIngredient} で推定する（辞書に無ければ
 * 「その他」）。`is_manual` を立てるので、献立を作り直しても消えない。
 *
 * @returns 追加された行。名前が空なら null
 */
export async function addManualItem(
  planId: string,
  input: ManualItemInput,
): Promise<ShoppingItemRow | null> {
  const displayName = input.displayName.trim();
  if (displayName === "") return null;

  const existing = await db.shoppingItems.where("meal_plan_id").equals(planId).toArray();
  const maxPosition = existing.reduce((max, row) => Math.max(max, row.position), -1);

  const row: ShoppingItemRow = {
    id: newId(),
    shopping_list_id: shoppingListId(planId),
    meal_plan_id: planId,
    ingredient_id: null,
    display_name: displayName,
    quantity: input.quantity,
    unit: input.unit?.trim() || null,
    ambiguous_note: null,
    category: classifyIngredient(displayName).category,
    is_checked: false,
    is_manual: true,
    source_recipe_ids: [],
    position: maxPosition + 1,
  };
  await db.shoppingItems.add(row);
  return row;
}

/**
 * 買い物リストから項目を削除する。
 *
 * 献立由来の項目を消しても次の組み立て直しで戻ってくるため、UI では手動追加の項目に
 * だけ削除を出す（買わない品は常備品にするか、チェックして消す運用）。
 */
export async function removeShoppingItem(id: string): Promise<void> {
  await db.shoppingItems.delete(id);
}

/** 項目のチェック状態を更新する（買い出し中の主操作）。 */
export async function setItemChecked(id: string, isChecked: boolean): Promise<void> {
  await db.shoppingItems.update(id, { is_checked: isChecked });
}

/**
 * 対象献立の買い物リストのチェックをすべて外す（買い出しが終わった後の片付け）。
 *
 * @returns 外した項目数
 */
export async function clearChecked(planId: string): Promise<number> {
  const rows = await db.shoppingItems.where("meal_plan_id").equals(planId).toArray();
  const checked = rows.filter((row) => row.is_checked);
  if (checked.length > 0) {
    await db.shoppingItems.bulkPut(checked.map((row) => ({ ...row, is_checked: false })));
  }
  return checked.length;
}

/**
 * 常備品として登録されている食材 ID の集合を返す（表示フィルタ用）。
 * IndexedDB は boolean をキーにできないため、メモリ側で絞り込む。
 */
export async function pantryIngredientIds(): Promise<Set<string>> {
  const masters = await db.ingredients.toArray();
  return new Set(masters.filter((m) => m.is_pantry_staple).map((m) => m.id));
}
