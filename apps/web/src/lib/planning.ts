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
  type Recipe,
  type RecipeForShopping,
  type ShoppingItem,
  type SlotRequest,
} from "@recipe-planner/core";
import { db, type MealPlanRow, type MealRow, type PlanSlotRow } from "../db/schema.ts";
import { toIngredient, toRecipe, toRecipeIngredient } from "../db/mappers.ts";
import { addDays, isWeekend, today } from "./date.ts";

/**
 * 献立生成の対象レシピを読み込む。無効化されたソース（`is_enabled=false`）に属する
 * レシピは除外する（US-03）。`source_id` が無い/未知のレシピは対象に含める。
 */
async function loadEligibleRecipes(): Promise<Recipe[]> {
  const [recipeRows, sources] = await Promise.all([
    db.recipes.toArray(),
    db.sources.toArray(),
  ]);
  const disabled = new Set(sources.filter((s) => !s.is_enabled).map((s) => s.id));
  return recipeRows
    .filter((r) => !(r.source_id !== null && disabled.has(r.source_id)))
    .map(toRecipe);
}

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
  const recipes = await loadEligibleRecipes();
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

/** 再抽選の結果。 */
export interface ReshuffleResult {
  plan: MealPlanRow;
  relaxations: string[];
  /** 候補が見つからず未割当になったスロット数。 */
  unfilledCount: number;
  /** 別のレシピが見つからず現状維持したスロット数（スロット単位再抽選時）。 */
  noAlternativeCount: number;
}

/** プラン内の全スロットを { slot, date } で列挙する。 */
function flattenSlots(plan: MealPlanRow): { slot: PlanSlotRow; date: string }[] {
  return plan.meals.flatMap((m) => m.slots.map((slot) => ({ slot, date: m.date })));
}

/**
 * プランの一部スロットを再抽選する汎用ロジック（F-02-3）。
 *
 * ロックされたスロットは対象から除外して固定する。対象外スロットに割り当て済みの
 * レシピは候補から除外し、週内の重複を避ける。
 *
 * @param plan - 対象プラン（破壊しない。更新済みのクローンを返す）
 * @param targetSlotIds - 再抽選したいスロット ID
 * @param forceChange - true なら対象スロットの現レシピも除外し、必ず別のレシピにする
 *   （スロット単位の「別のレシピにする」用。代替が無ければ現状維持）
 */
async function reshuffleSlots(
  plan: MealPlanRow,
  targetSlotIds: readonly string[],
  forceChange: boolean,
): Promise<ReshuffleResult> {
  const next = structuredClone(plan) as MealPlanRow;
  const all = flattenSlots(next);
  const targets = new Set(targetSlotIds);

  // ロック済みは再抽選しない。
  const regen = all.filter(({ slot }) => targets.has(slot.id) && !slot.is_locked);
  const regenIds = new Set(regen.map(({ slot }) => slot.id));

  // 対象外スロットのレシピは固定 → 候補から除外して重複を防ぐ。
  const excluded = new Set<string>();
  for (const { slot } of all) {
    if (!regenIds.has(slot.id) && slot.recipe_id) excluded.add(slot.recipe_id);
  }
  // スロット単位: 現レシピも除外して必ず変える。
  const currentBySlot = new Map<string, string | null>();
  for (const { slot } of regen) {
    currentBySlot.set(slot.id, slot.recipe_id);
    if (forceChange && slot.recipe_id) excluded.add(slot.recipe_id);
  }

  const recipes = await loadEligibleRecipes();
  const result = generateMealPlan({
    slots: regen.map(({ slot, date }) => ({
      slotId: slot.id,
      dishRole: slot.dish_role,
      isWeekend: isWeekend(date),
    })),
    recipes,
    referenceDate: today(),
    excludeRecipeIds: [...excluded],
    rng: Math.random,
  });

  const picked = new Map(result.assignments.map((a) => [a.slotId, a.recipeId] as const));
  let noAlternativeCount = 0;
  for (const { slot } of regen) {
    const newId = picked.get(slot.id) ?? null;
    // 別のレシピが見つからなければ現状維持（皿を空にしない）。
    if (forceChange && newId === null && currentBySlot.get(slot.id)) {
      noAlternativeCount++;
      continue;
    }
    slot.recipe_id = newId;
  }

  next.updated_at = new Date().toISOString();
  await db.mealPlans.put(next);

  // 未割当は最終状態から数える（現状維持したスロットは未割当に含めない）。
  const unfilledCount = regen.filter(({ slot }) => slot.recipe_id === null).length;

  return {
    plan: next,
    relaxations: result.relaxations,
    unfilledCount,
    noAlternativeCount,
  };
}

/** スロット 1 つを別のレシピに再抽選する（US-05）。 */
export function reshuffleSlot(plan: MealPlanRow, slotId: string): Promise<ReshuffleResult> {
  return reshuffleSlots(plan, [slotId], true);
}

/** 1 日分の未ロックスロットを再抽選する（F-02-3 食事単位）。 */
export function reshuffleMeal(plan: MealPlanRow, mealId: string): Promise<ReshuffleResult> {
  const meal = plan.meals.find((m) => m.id === mealId);
  const slotIds = meal ? meal.slots.map((s) => s.id) : [];
  return reshuffleSlots(plan, slotIds, false);
}

/** 週全体の未ロックスロットを再抽選する（F-02-3 週単位。ロックは維持）。 */
export function reshuffleWeek(plan: MealPlanRow): Promise<ReshuffleResult> {
  const slotIds = flattenSlots(plan).map(({ slot }) => slot.id);
  return reshuffleSlots(plan, slotIds, false);
}

/** スロットのロック状態をトグルして保存する（US-06）。 */
export async function toggleSlotLock(plan: MealPlanRow, slotId: string): Promise<MealPlanRow> {
  const next = structuredClone(plan) as MealPlanRow;
  for (const meal of next.meals) {
    for (const slot of meal.slots) {
      if (slot.id === slotId) slot.is_locked = !slot.is_locked;
    }
  }
  next.updated_at = new Date().toISOString();
  await db.mealPlans.put(next);
  return next;
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
