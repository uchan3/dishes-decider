import { describe, expect, it } from "vitest";
import type { RecipeIngredient } from "../types/index.ts";
import { isStalePantryItem, matchPantry } from "./index.ts";

const line = (partial: Partial<RecipeIngredient> & { id: string }): RecipeIngredient => ({
  recipeId: "r1",
  ingredientId: partial.id,
  displayName: "材料",
  rawText: "材料",
  quantity: 1,
  unit: "個",
  isAmbiguous: false,
  ...partial,
});

describe("matchPantry", () => {
  it("returns the share of ingredients that are at home", () => {
    const result = matchPantry({
      ingredients: [line({ id: "onion" }), line({ id: "pork" })],
      pantryIngredientIds: new Set(["onion"]),
    });
    expect(result).toEqual({ score: 0.5, matched: 1, missing: 1, targetCount: 2 });
  });

  it("ignores pantry staples so seasonings never move the score", () => {
    const result = matchPantry({
      ingredients: [line({ id: "onion" }), line({ id: "soy" })],
      pantryIngredientIds: new Set(["onion"]),
      isPantryStaple: (id) => id === "soy",
    });
    expect(result).toEqual({ score: 1, matched: 1, missing: 0, targetCount: 1 });
  });

  it("ignores ingredients with no master and vague amounts", () => {
    const result = matchPantry({
      ingredients: [
        line({ id: "onion" }),
        line({ id: "x", ingredientId: null }),
        line({ id: "salt", isAmbiguous: true }),
      ],
      pantryIngredientIds: new Set(["onion"]),
    });
    expect(result.targetCount).toBe(1);
    expect(result.score).toBe(1);
  });

  it("scores zero — not negative — when nothing is comparable", () => {
    expect(
      matchPantry({ ingredients: [], pantryIngredientIds: new Set(["onion"]) }),
    ).toEqual({ score: 0, matched: 0, missing: 0, targetCount: 0 });

    expect(
      matchPantry({
        ingredients: [line({ id: "x", ingredientId: null })],
        pantryIngredientIds: new Set(["onion"]),
      }).score,
    ).toBe(0);
  });

  it("scores zero when the fridge is empty", () => {
    const result = matchPantry({
      ingredients: [line({ id: "onion" }), line({ id: "pork" })],
      pantryIngredientIds: new Set(),
    });
    expect(result).toEqual({ score: 0, matched: 0, missing: 2, targetCount: 2 });
  });
});

describe("isStalePantryItem", () => {
  const NOW = new Date("2026-08-23T12:00:00Z");
  const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

  it("flags fresh produce after 5 days", () => {
    expect(isStalePantryItem(daysAgo(4), "vegetable", NOW)).toBe(false);
    expect(isStalePantryItem(daysAgo(6), "vegetable", NOW)).toBe(true);
    expect(isStalePantryItem(daysAgo(6), "meat", NOW)).toBe(true);
    expect(isStalePantryItem(daysAgo(6), "seafood", NOW)).toBe(true);
  });

  it("gives dry goods and frozen items longer", () => {
    expect(isStalePantryItem(daysAgo(10), "dry_goods", NOW)).toBe(false);
    expect(isStalePantryItem(daysAgo(15), "dry_goods", NOW)).toBe(true);
    expect(isStalePantryItem(daysAgo(10), "frozen", NOW)).toBe(false);
  });

  it("treats an unknown category as non-perishable", () => {
    expect(isStalePantryItem(daysAgo(10), null, NOW)).toBe(false);
    expect(isStalePantryItem(daysAgo(15), null, NOW)).toBe(true);
  });

  it("never flags something added just now, and tolerates a broken date", () => {
    expect(isStalePantryItem(NOW.toISOString(), "vegetable", NOW)).toBe(false);
    expect(isStalePantryItem("こわれた日付", "vegetable", NOW)).toBe(false);
  });
});
