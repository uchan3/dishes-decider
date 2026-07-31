import { describe, expect, it } from "vitest";
import { makeRecipe } from "../testing.ts";
import {
  DEFAULT_WEIGHTS,
  daysBetween,
  noveltyScore,
  recencyScore,
  rejectPenalty,
  scoreRecipe,
  varietyPenalty,
} from "./scoring.ts";

describe("daysBetween", () => {
  it("returns positive day difference from earlier to later", () => {
    expect(daysBetween("2026-07-01", "2026-07-15")).toBe(14);
  });

  it("returns 0 for invalid dates", () => {
    expect(daysBetween("not-a-date", "2026-07-15")).toBe(0);
  });
});

describe("recencyScore", () => {
  it("gives max score to never-cooked recipes", () => {
    const r = makeRecipe({ id: "a", lastCookedAt: null });
    expect(recencyScore(r, "2026-07-30", 14)).toBe(1);
  });

  it("scales with days since last cooked, capped at 1", () => {
    const r = makeRecipe({ id: "a", lastCookedAt: "2026-07-23" }); // 7 days ago
    expect(recencyScore(r, "2026-07-30", 14)).toBeCloseTo(0.5, 5);
  });

  it("caps at 1 when well past the horizon", () => {
    const r = makeRecipe({ id: "a", lastCookedAt: "2026-01-01" });
    expect(recencyScore(r, "2026-07-30", 14)).toBe(1);
  });
});

describe("noveltyScore", () => {
  it("is highest for never-cooked and decreases with cook count", () => {
    expect(noveltyScore(makeRecipe({ id: "a", cookCount: 0 }))).toBe(1);
    expect(noveltyScore(makeRecipe({ id: "a", cookCount: 1 }))).toBe(0.5);
    expect(noveltyScore(makeRecipe({ id: "a", cookCount: 9 }))).toBeCloseTo(0.1, 5);
  });
});

describe("rejectPenalty", () => {
  it("scales to 3 rejects then saturates", () => {
    expect(rejectPenalty(makeRecipe({ id: "a", rejectCount: 0 }))).toBe(0);
    expect(rejectPenalty(makeRecipe({ id: "a", rejectCount: 3 }))).toBe(1);
    expect(rejectPenalty(makeRecipe({ id: "a", rejectCount: 10 }))).toBe(1);
  });
});

describe("varietyPenalty", () => {
  it("penalizes shared main ingredient category and cooking method", () => {
    const r = makeRecipe({ id: "a", mainIngredientCategory: "pork", cookingMethod: "fry" });
    const same = makeRecipe({
      id: "b",
      mainIngredientCategory: "pork",
      cookingMethod: "fry",
    });
    // 0.5 (category) + 0.5 (method)
    expect(varietyPenalty(r, [same])).toBe(1);
  });

  it("does not penalize when categories are null", () => {
    const r = makeRecipe({ id: "a", mainIngredientCategory: null, cookingMethod: null });
    const other = makeRecipe({ id: "b", mainIngredientCategory: null });
    expect(varietyPenalty(r, [other])).toBe(0);
  });
});

describe("scoreRecipe", () => {
  it("ranks a fresh favorite above a stale, over-cooked, rejected one", () => {
    const fresh = makeRecipe({
      id: "fresh",
      isFavorite: true,
      cookCount: 0,
      lastCookedAt: null,
    });
    const stale = makeRecipe({
      id: "stale",
      isFavorite: false,
      cookCount: 20,
      lastCookedAt: "2026-07-29",
      rejectCount: 3,
    });
    const ctx = {
      referenceDate: "2026-07-30",
      horizonDays: 14,
      selected: [],
      weights: DEFAULT_WEIGHTS,
    };
    expect(scoreRecipe(fresh, ctx)).toBeGreaterThan(scoreRecipe(stale, ctx));
  });
});
