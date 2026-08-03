/**
 * core のドメインロジックと Dexie を繋ぐアプリ層。
 *
 * 献立生成 (`generateMealPlan`) と買い物リスト集約 (`aggregateShoppingList`) を
 * ローカル DB のデータで駆動し、結果を Dexie に永続化する。
 */

import {
  aggregateShoppingList,
  generateMealPlan,
  type DishRole,
  type RecipeForShopping,
  type ShoppingItem,
  type SlotRequest,
} from "@recipe-planner/core";
import { db, type MealPlanRow, type MealRow, type PlanSlotRow } from "../db/schema.ts";
import { toIngredient, toRecipe, toRecipeIngredient } from "../db/mappers.ts";
import { addDays, isWeekend, today } from "./date.ts";

/** 曜日ごとのスロット構成（平日=標準 / 土日=がっつり）。 */
function templateFor(date: string): DishRole[] {
  return isWeekend(date) ? ["main", "side", "side"] : ["main", "side"];
}

/** 週の 7 日分のスロット要求を組み立てる。slotId は `date#role#index`。 */
function buildWeekSlots(startDate: string): {
  slots: SlotRequest[];
  slotDate: Map<string, string>;
} {
  const slots: SlotRequest[] = [];
  const slotDate = new Map<string, string>();
  for (let i = 0; i < 7; i++) {
    const date = addDays(startDate, i);
    const roles = templateFor(date);
    roles.forEach((role, idx) => {
      const slotId = `${date}#${role}#${idx}`;
      slots.push({ slotId, dishRole: role, isWeekend: isWeekend(date) });
      slotDate.set(slotId, date);
    });
  }
  return { slots, slotDate };
}

/** 生成結果。 */
export interface GeneratedWeek {
  plan: MealPlanRow;
  /** 緩和された制約（UI 通知用）。 */
  relaxations: string[];
  /** 埋められなかったスロット数。 */
  unfilledCount: number;
}

/**
 * 指定週の献立を生成して Dexie に保存する。
 *
 * @param startDate - 週開始日 (YYYY-MM-DD)
 * @returns 生成された献立と緩和情報
 */
export async function generateWeek(startDate: string): Promise<GeneratedWeek> {
  const recipeRows = await db.recipes.toArray();
  const recipes = recipeRows.map(toRecipe);
  const { slots, slotDate } = buildWeekSlots(startDate);

  const result = generateMealPlan({
    slots,
    recipes,
    referenceDate: today(),
    rng: Math.random, // UI では再生成のたびに変化させる
  });

  const bySlot = new Map(result.assignments.map((a) => [a.slotId, a] as const));

  // 日付ごとに Meal を組み立てる。
  const mealsByDate = new Map<string, MealRow>();
  for (const slot of slots) {
    const date = slotDate.get(slot.slotId) as string;
    let meal = mealsByDate.get(date);
    if (!meal) {
      meal = {
        id: `meal-${date}`,
        date,
        meal_type: "dinner",
        template_id: null,
        is_skipped: false,
        slots: [],
      };
      mealsByDate.set(date, meal);
    }
    const assignment = bySlot.get(slot.slotId);
    const planSlot: PlanSlotRow = {
      id: slot.slotId,
      dish_role: slot.dishRole,
      recipe_id: assignment?.recipeId ?? null,
      is_locked: false,
      position: meal.slots.length,
    };
    meal.slots.push(planSlot);
  }

  const nowIso = new Date().toISOString();
  const plan: MealPlanRow = {
    id: `plan-${startDate}`,
    start_date: startDate,
    status: "draft",
    meals: [...mealsByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    created_at: nowIso,
    updated_at: nowIso,
  };

  await db.mealPlans.put(plan);

  return {
    plan,
    relaxations: result.relaxations,
    unfilledCount: result.unfilledSlotIds.length,
  };
}

/**
 * 献立から買い物リスト項目を集約する（Dexie の材料・食材マスタを参照）。
 *
 * @param plan - 対象の週間献立
 * @param householdSize - 世帯人数
 * @param includePantryStaples - 常備品も含めるか
 */
export async function buildShoppingItems(
  plan: MealPlanRow,
  householdSize: number,
  includePantryStaples = false,
): Promise<ShoppingItem[]> {
  const recipeIds = [
    ...new Set(
      plan.meals.flatMap((m) => m.slots.map((s) => s.recipe_id).filter((x): x is string => x !== null)),
    ),
  ];

  const [recipeRows, lineRows, ingredientRows] = await Promise.all([
    db.recipes.bulkGet(recipeIds),
    db.recipeIngredients.where("recipe_id").anyOf(recipeIds).toArray(),
    db.ingredients.toArray(),
  ]);

  const linesByRecipe = new Map<string, ReturnType<typeof toRecipeIngredient>[]>();
  for (const row of lineRows) {
    const list = linesByRecipe.get(row.recipe_id) ?? [];
    list.push(toRecipeIngredient(row));
    linesByRecipe.set(row.recipe_id, list);
  }

  const recipes = new Map<string, RecipeForShopping>();
  for (const row of recipeRows) {
    if (!row) continue;
    const r = toRecipe(row);
    recipes.set(r.id, {
      id: r.id,
      servings: r.servings,
      ingredients: linesByRecipe.get(r.id) ?? [],
    });
  }

  const ingredients = new Map(ingredientRows.map((row) => [row.id, toIngredient(row)] as const));

  const slots = plan.meals.flatMap((m) => m.slots.map((s) => ({ recipeId: s.recipe_id })));

  return aggregateShoppingList({ slots, recipes, ingredients, householdSize, includePantryStaples });
}
