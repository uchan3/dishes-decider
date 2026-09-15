import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase.ts", () => ({ isSupabaseConfigured: true, supabase: {} }));
// 送信は別テストで見る。ここでは「キューに積まれるか」だけ確認したいので黙らせる。
vi.mock("./outboxSync.ts", () => ({ flushSoon: () => {}, flushNow: async () => ({}) }));

import { db, type MealPlanRow, type RecipeRow } from "../db/schema.ts";
import {
  buildShoppingItems,
  clearSlot,
  generateWeek,
  setMealSkipped,
  setSlotRecipe,
} from "./planning.ts";

const RECIPE_A = "aaaaaaaa-0000-4000-8000-000000000001";
const RECIPE_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ONION = "cccccccc-0000-4000-8000-000000000003";

const recipe = (id: string, title: string): RecipeRow => ({
  id,
  source_id: null,
  title,
  source_url: null,
  thumbnail_url: null,
  dish_roles: ["main", "side", "one_dish", "soup", "staple"],
  cook_time_min: 20,
  servings: 2,
  main_ingredient_category: null,
  cooking_method: null,
  tags: [],
  is_favorite: false,
  is_excluded: false,
  cook_count: 0,
  last_cooked_at: null,
  reject_count: 0,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
});

/** 2 日ぶんだけの最小プラン（1 日目に主菜 1 枠、2 日目に主菜 1 枠）。 */
const plan = (): MealPlanRow => ({
  id: "plan-2026-09-14",
  start_date: "2026-09-14",
  status: "draft",
  meals: [
    {
      id: "meal-2026-09-14",
      date: "2026-09-14",
      meal_type: "dinner",
      template_id: "standard",
      is_skipped: false,
      slots: [
        {
          id: "2026-09-14#main#0",
          dish_role: "main",
          recipe_id: RECIPE_A,
          is_locked: false,
          position: 0,
          cooked_at: null,
        },
      ],
    },
    {
      id: "meal-2026-09-15",
      date: "2026-09-15",
      meal_type: "dinner",
      template_id: "standard",
      is_skipped: false,
      slots: [
        {
          id: "2026-09-15#main#0",
          dish_role: "main",
          recipe_id: RECIPE_B,
          is_locked: false,
          position: 0,
          cooked_at: null,
        },
      ],
    },
  ],
  created_at: "2026-09-14T00:00:00.000Z",
  updated_at: "2026-09-14T00:00:00.000Z",
});

const slotOf = (p: MealPlanRow, id: string) =>
  p.meals.flatMap((m) => m.slots).find((s) => s.id === id);

describe("manual plan editing", () => {
  beforeEach(async () => {
    await Promise.all([
      db.mealPlans.clear(),
      db.recipes.clear(),
      db.recipeIngredients.clear(),
      db.ingredients.clear(),
      db.outbox.clear(),
      db.settings.clear(),
      db.pantryItems.clear(),
    ]);
    await db.mealPlans.put(plan());
  });

  it("empties a slot and drops its lock", async () => {
    const next = await clearSlot(plan(), "2026-09-14#main#0");

    expect(slotOf(next, "2026-09-14#main#0")?.recipe_id).toBeNull();
    expect(slotOf(next, "2026-09-14#main#0")?.is_locked).toBe(false);
    expect((await db.mealPlans.get("plan-2026-09-14"))?.meals[0]?.slots[0]?.recipe_id).toBeNull();
  });

  it("locks a recipe the user picked (勝手に入れ替わらないように)", async () => {
    const next = await setSlotRecipe(plan(), "2026-09-14#main#0", RECIPE_B);

    expect(slotOf(next, "2026-09-14#main#0")?.recipe_id).toBe(RECIPE_B);
    expect(slotOf(next, "2026-09-14#main#0")?.is_locked).toBe(true);
  });

  it("queues the week for the other device on every edit", async () => {
    await clearSlot(plan(), "2026-09-14#main#0");

    const queued = await db.outbox.toArray();
    expect(queued.map((row) => [row.table_name, row.record_id])).toEqual([
      ["planDocs", "plan-2026-09-14"],
    ]);
  });

  it("keeps the dishes when a day is marked as eating out (戻せば元どおり)", async () => {
    const skipped = await setMealSkipped(plan(), "meal-2026-09-14", true);
    expect(skipped.meals[0]?.is_skipped).toBe(true);
    expect(skipped.meals[0]?.slots[0]?.recipe_id).toBe(RECIPE_A);

    const restored = await setMealSkipped(skipped, "meal-2026-09-14", false);
    expect(restored.meals[0]?.is_skipped).toBe(false);
    expect(restored.meals[0]?.slots[0]?.recipe_id).toBe(RECIPE_A);
  });
});

describe("shopping list and manual edits", () => {
  beforeEach(async () => {
    await Promise.all([
      db.mealPlans.clear(),
      db.recipes.clear(),
      db.recipeIngredients.clear(),
      db.ingredients.clear(),
      db.outbox.clear(),
    ]);
    await db.recipes.bulkPut([recipe(RECIPE_A, "肉じゃが"), recipe(RECIPE_B, "生姜焼き")]);
    await db.ingredients.put({
      id: ONION,
      canonical_name: "玉ねぎ",
      kana: null,
      aliases: [],
      category: "vegetable",
      default_unit: "個",
      is_pantry_staple: false,
      sort_order: 0,
    });
    await db.recipeIngredients.bulkPut(
      [RECIPE_A, RECIPE_B].map((recipeId, i) => ({
        id: `line-${i}`,
        recipe_id: recipeId,
        ingredient_id: ONION,
        raw_text: "玉ねぎ 1個",
        display_name: "玉ねぎ",
        quantity: 1,
        unit: "個",
        is_ambiguous: false,
        position: 0,
      })),
    );
  });

  it("counts both days while they are both being cooked", async () => {
    const items = await buildShoppingItems(plan(), 2);

    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe(2); // 2 日ぶん
  });

  it("leaves a day out of the shopping list once it is marked as eating out", async () => {
    const skipped = await setMealSkipped(plan(), "meal-2026-09-14", true);

    const items = await buildShoppingItems(skipped, 2);

    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe(1); // 残り 1 日ぶんだけ
  });

  it("drops an emptied slot from the shopping list", async () => {
    const cleared = await clearSlot(plan(), "2026-09-14#main#0");

    const items = await buildShoppingItems(cleared, 2);

    expect(items[0]?.quantity).toBe(1);
  });
});

describe("regenerating the week", () => {
  beforeEach(async () => {
    await Promise.all([
      db.mealPlans.clear(),
      db.recipes.clear(),
      db.recipeIngredients.clear(),
      db.ingredients.clear(),
      db.outbox.clear(),
      db.settings.clear(),
      db.pantryItems.clear(),
    ]);
    await db.recipes.bulkPut([recipe(RECIPE_A, "肉じゃが"), recipe(RECIPE_B, "生姜焼き")]);
  });

  it("remembers the days marked as eating out (毎回付け直さなくてよい)", async () => {
    const first = await generateWeek("2026-09-14");
    const target = first.plan.meals[2]?.id as string;
    const targetDate = first.plan.meals[2]?.date as string;
    await setMealSkipped(first.plan, target, true);

    const again = await generateWeek("2026-09-14");

    const meal = again.plan.meals.find((m) => m.date === targetDate);
    expect(meal?.is_skipped).toBe(true);
    // 外食の日は抽選もしない（候補を無駄に使わないため）。
    expect(meal?.slots.every((s) => s.recipe_id === null)).toBe(true);
  });
});
