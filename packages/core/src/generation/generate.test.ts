import { describe, expect, it } from "vitest";
import { makeRecipe } from "../testing.ts";
import { generateMealPlan, type SlotRequest } from "./generate.ts";
import { mulberry32 } from "./rng.ts";

const REF = "2026-07-30";

/** 主菜スロットを n 個作るヘルパー。 */
function mainSlots(n: number): SlotRequest[] {
  return Array.from({ length: n }, (_, i) => ({
    slotId: `s${i}`,
    dishRole: "main" as const,
    isWeekend: false,
  }));
}

describe("generateMealPlan", () => {
  it("assigns a recipe to each slot when enough candidates exist", () => {
    const recipes = [
      makeRecipe({ id: "a" }),
      makeRecipe({ id: "b" }),
      makeRecipe({ id: "c" }),
    ];
    const result = generateMealPlan({
      slots: mainSlots(3),
      recipes,
      referenceDate: REF,
      rng: mulberry32(1),
    });
    expect(result.unfilledSlotIds).toEqual([]);
    const ids = result.assignments.map((a) => a.recipeId);
    expect(new Set(ids).size).toBe(3); // no same-week duplicates
  });

  it("keeps locked slots fixed and excludes them from other picks", () => {
    const recipes = [makeRecipe({ id: "a" }), makeRecipe({ id: "b" })];
    const slots: SlotRequest[] = [
      { slotId: "s0", dishRole: "main", isWeekend: false, lockedRecipeId: "a" },
      { slotId: "s1", dishRole: "main", isWeekend: false },
    ];
    const result = generateMealPlan({ slots, recipes, referenceDate: REF, rng: mulberry32(1) });
    const locked = result.assignments.find((a) => a.slotId === "s0");
    const open = result.assignments.find((a) => a.slotId === "s1");
    expect(locked).toMatchObject({ recipeId: "a", locked: true });
    expect(open?.recipeId).toBe("b"); // "a" is already used
  });

  it("filters out recipes within the cooldown window", () => {
    const recipes = [
      makeRecipe({ id: "recent", lastCookedAt: "2026-07-28" }), // 2 days ago < 14
      makeRecipe({ id: "old", lastCookedAt: "2026-06-01" }),
    ];
    const result = generateMealPlan({
      slots: mainSlots(1),
      recipes,
      referenceDate: REF,
      settings: { cooldownDays: 14 },
      rng: mulberry32(1),
    });
    expect(result.assignments[0]?.recipeId).toBe("old");
  });

  it("never selects excluded recipes even when no other candidate exists", () => {
    const recipes = [makeRecipe({ id: "x", isExcluded: true })];
    const result = generateMealPlan({
      slots: mainSlots(1),
      recipes,
      referenceDate: REF,
      rng: mulberry32(1),
    });
    expect(result.assignments[0]?.recipeId).toBeNull();
    expect(result.unfilledSlotIds).toEqual(["s0"]);
  });

  it("relaxes the cook-time limit when it would leave a slot empty", () => {
    const recipes = [makeRecipe({ id: "slow", cookTimeMin: 90 })];
    const result = generateMealPlan({
      slots: mainSlots(1),
      recipes,
      referenceDate: REF,
      settings: { weekdayMaxCookMin: 30 },
      rng: mulberry32(1),
    });
    expect(result.assignments[0]?.recipeId).toBe("slow");
    expect(result.assignments[0]?.relaxed).toContain("cook_time");
    expect(result.relaxations).toContain("cook_time");
  });

  it("relaxes cooldown before allowing same-week duplicates", () => {
    // Only one candidate, recently cooked, and two slots to fill.
    const recipes = [makeRecipe({ id: "only", lastCookedAt: "2026-07-29" })];
    const result = generateMealPlan({
      slots: mainSlots(2),
      recipes,
      referenceDate: REF,
      settings: { cooldownDays: 14 },
      rng: mulberry32(1),
    });
    expect(result.relaxations).toContain("cooldown");
    // second slot needs same-week duplicate to be filled by the single recipe
    expect(result.relaxations).toContain("same_week_duplicate");
    expect(result.unfilledSlotIds).toEqual([]);
  });

  it("reduces main-ingredient over-concentration via variety retries", () => {
    // 5 pork mains + several chicken alternatives. Threshold 3 should trigger reroll.
    const recipes = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeRecipe({ id: `pork${i}`, mainIngredientCategory: "pork" }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeRecipe({ id: `chicken${i}`, mainIngredientCategory: "chicken" }),
      ),
    ];
    const result = generateMealPlan({
      slots: mainSlots(5),
      recipes,
      referenceDate: REF,
      settings: { varietyThreshold: 3, maxVarietyRetries: 3 },
      rng: mulberry32(7),
    });
    const cats = result.assignments
      .map((a) => recipes.find((r) => r.id === a.recipeId)?.mainIngredientCategory)
      .filter((c): c is string => Boolean(c));
    const porkCount = cats.filter((c) => c === "pork").length;
    expect(porkCount).toBeLessThanOrEqual(4); // no longer all 5 pork
  });

  it("is deterministic for a given rng seed", () => {
    const recipes = Array.from({ length: 6 }, (_, i) => makeRecipe({ id: `r${i}` }));
    const run = () =>
      generateMealPlan({
        slots: mainSlots(3),
        recipes,
        referenceDate: REF,
        rng: mulberry32(99),
      }).assignments.map((a) => a.recipeId);
    expect(run()).toEqual(run());
  });

  it("respects excludeRecipeIds", () => {
    const recipes = [makeRecipe({ id: "a" }), makeRecipe({ id: "b" })];
    const result = generateMealPlan({
      slots: mainSlots(1),
      recipes,
      referenceDate: REF,
      excludeRecipeIds: ["a"],
      rng: mulberry32(1),
    });
    expect(result.assignments[0]?.recipeId).toBe("b");
  });
});
