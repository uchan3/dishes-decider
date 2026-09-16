import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase.ts", () => ({ isSupabaseConfigured: true, supabase: {} }));
vi.mock("./outboxSync.ts", () => ({ flushSoon: () => {}, flushNow: async () => ({}) }));

import { db, type MealPlanRow, type RecipeRow } from "../db/schema.ts";
import { addDays, today } from "./date.ts";
import { applyRejectReason } from "./reject.ts";
import { DEFAULT_PLANNING_SETTINGS, savePlanningSettings } from "./settings.ts";

const RECIPE = "aaaaaaaa-0000-4000-8000-000000000001";
const PLAN_ID = "plan-2026-09-14";

const recipe = (partial: Partial<RecipeRow> = {}): RecipeRow => ({
  id: RECIPE,
  source_id: null,
  title: "肉じゃが",
  source_url: null,
  thumbnail_url: null,
  dish_roles: ["main"],
  cook_time_min: 20,
  servings: 2,
  main_ingredient_category: null,
  cooking_method: null,
  tags: [],
  is_favorite: false,
  is_excluded: false,
  cook_count: 3,
  last_cooked_at: "2026-09-01",
  reject_count: 0,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  ...partial,
});

const plan = (): MealPlanRow => ({
  id: PLAN_ID,
  start_date: "2026-09-14",
  status: "draft",
  meals: [],
  created_at: "2026-09-14T00:00:00.000Z",
  updated_at: "2026-09-14T00:00:00.000Z",
});

describe("applyRejectReason", () => {
  beforeEach(async () => {
    await Promise.all([
      db.recipes.clear(),
      db.mealPlans.clear(),
      db.outbox.clear(),
      db.settings.clear(),
    ]);
    await db.recipes.put(recipe());
    await db.mealPlans.put(plan());
  });

  it("keeps a dish out of this week only (翌週には戻る)", async () => {
    await applyRejectReason("not_in_mood", RECIPE, PLAN_ID);

    expect((await db.mealPlans.get(PLAN_ID))?.excluded_recipe_ids).toEqual([RECIPE]);
    // レシピ自体には何も残さない（来週は普通に出てほしい）。
    const row = await db.recipes.get(RECIPE);
    expect(row?.is_excluded).toBe(false);
    expect(row?.snoozed_until ?? null).toBeNull();
  });

  it("does not list the same dish twice", async () => {
    await applyRejectReason("not_in_mood", RECIPE, PLAN_ID);
    await applyRejectReason("not_in_mood", RECIPE, PLAN_ID);

    expect((await db.mealPlans.get(PLAN_ID))?.excluded_recipe_ids).toEqual([RECIPE]);
  });

  it("snoozes for the cooldown period without faking a cooking record", async () => {
    await savePlanningSettings({ ...DEFAULT_PLANNING_SETTINGS, cooldownDays: 10 });

    await applyRejectReason("ate_recently", RECIPE, PLAN_ID);

    const row = await db.recipes.get(RECIPE);
    expect(row?.snoozed_until).toBe(addDays(today(), 10));
    // よそで食べただけなので、作った記録は動かさない（novelty が実態とずれる）。
    expect(row?.cook_count).toBe(3);
    expect(row?.last_cooked_at).toBe("2026-09-01");
  });

  it("adds a penalty when the ingredients are a hassle", async () => {
    await applyRejectReason("too_much_work", RECIPE, PLAN_ID);
    await applyRejectReason("too_much_work", RECIPE, PLAN_ID);

    expect((await db.recipes.get(RECIPE))?.reject_count).toBe(2);
  });

  it("excludes a dish for good", async () => {
    await applyRejectReason("never", RECIPE, PLAN_ID);

    expect((await db.recipes.get(RECIPE))?.is_excluded).toBe(true);
  });

  it("queues the change for the other device", async () => {
    await applyRejectReason("never", RECIPE, PLAN_ID);

    const queued = await db.outbox.toArray();
    expect(queued.map((row) => row.table_name)).toContain("recipes");
  });
});
