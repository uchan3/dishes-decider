/**
 * 調理の記録（F-02-2 の cooldown / novelty を実際に動かすための土台）。
 *
 * 献立生成のスコアリングは `last_cooked_at`（クールダウン）と `cook_count`（novelty）を
 * 読むが、これを更新する導線が無いと**どちらも初期値のまま**で、同じレシピが繰り返し
 * 選ばれてしまう（US-12 が効かない）。献立画面でスロットに「作った」を記録し、
 * レシピ側の実績に反映する。
 *
 * 記録はスロット単位（`cooked_at`）に持つ。こうすると取り消しが冪等になり、
 * 「作った」を 2 回押して調理回数が二重に増えることがない。
 */

import { db, type MealPlanRow } from "../db/schema.ts";
import { updateRecipe } from "./recipeEdit.ts";

/**
 * 保存済みの献立から、そのレシピを最後に作った日を求める（純粋関数）。
 *
 * 「作った」を取り消したときに `last_cooked_at` を戻すために使う。差分を巻き戻すのでなく
 * 記録から導出するので、押し間違いを繰り返しても値がずれない。
 *
 * @returns 最新の調理日 (YYYY-MM-DD)。一度も作っていなければ null
 */
export function deriveLastCookedAt(
  plans: readonly MealPlanRow[],
  recipeId: string,
): string | null {
  let latest: string | null = null;
  for (const plan of plans) {
    for (const meal of plan.meals) {
      for (const slot of meal.slots) {
        if (slot.recipe_id !== recipeId) continue;
        const cookedAt = slot.cooked_at ?? null;
        if (cookedAt !== null && (latest === null || cookedAt > latest)) latest = cookedAt;
      }
    }
  }
  return latest;
}

/** スロットが調理済みかどうか。 */
export const isSlotCooked = (cookedAt: string | null | undefined): boolean => Boolean(cookedAt);

/**
 * スロットの「作った」記録を切り替え、レシピの調理実績を更新する。
 *
 * 記録した日はそのスロットの日付（献立上の日）を使う。レシピ側の更新は
 * {@link updateRecipe} 経由なので Supabase にも反映される（Dexie だけ直すと次回プルで
 * 巻き戻るため）。
 *
 * @param plan - 対象の週間献立
 * @param slotId - 対象スロット ID
 * @param cooked - true なら「作った」、false なら取り消し
 * @returns 更新後の献立
 */
export async function setSlotCooked(
  plan: MealPlanRow,
  slotId: string,
  cooked: boolean,
): Promise<MealPlanRow> {
  const next = structuredClone(plan) as MealPlanRow;

  const meal = next.meals.find((m) => m.slots.some((s) => s.id === slotId));
  const slot = meal?.slots.find((s) => s.id === slotId);
  if (!meal || !slot) return plan;
  // 既に同じ状態なら何もしない（調理回数の二重加算を防ぐ）。
  if (isSlotCooked(slot.cooked_at) === cooked) return plan;

  slot.cooked_at = cooked ? meal.date : null;
  next.updated_at = new Date().toISOString();
  await db.mealPlans.put(next);

  const recipeId = slot.recipe_id;
  if (recipeId === null) return next;

  const recipe = await db.recipes.get(recipeId);
  if (!recipe) return next;

  const cookCount = Math.max(0, recipe.cook_count + (cooked ? 1 : -1));
  const lastCookedAt = cooked
    ? // 過去の日付を後から記録しても、最新の調理日は後退させない。
      recipe.last_cooked_at !== null && recipe.last_cooked_at > meal.date
      ? recipe.last_cooked_at
      : meal.date
    : // 取り消し時は残っている記録から導出する（記録が無ければ未調理に戻す）。
      deriveLastCookedAt(await db.mealPlans.toArray(), recipeId);

  await updateRecipe(recipeId, { cook_count: cookCount, last_cooked_at: lastCookedAt });
  return next;
}
