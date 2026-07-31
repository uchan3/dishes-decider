import { describe, expect, it } from "vitest";
import { makeIngredientLine, makeMaster } from "../testing.ts";
import type { Ingredient } from "../types/index.ts";
import {
  aggregateShoppingList,
  type RecipeForShopping,
} from "./aggregate.ts";

const masters = new Map<string, Ingredient>([
  ["onion", makeMaster({ id: "onion", canonicalName: "玉ねぎ", category: "vegetable" })],
  ["pork", makeMaster({ id: "pork", canonicalName: "豚こま", category: "meat" })],
  [
    "soy",
    makeMaster({
      id: "soy",
      canonicalName: "醤油",
      category: "seasoning",
      isPantryStaple: true,
    }),
  ],
]);

/** 2 人前レシピを組み立てるヘルパー。 */
function recipe(
  id: string,
  lines: ReadonlyArray<Parameters<typeof makeIngredientLine>[0]>,
  servings = 2,
): RecipeForShopping {
  return {
    id,
    servings,
    ingredients: lines.map((l) => makeIngredientLine(l)),
  };
}

describe("aggregateShoppingList", () => {
  it("groups the same ingredient across recipes and sums same-unit counts", () => {
    const recipes = new Map<string, RecipeForShopping>([
      [
        "r1",
        recipe("r1", [
          { id: "l1", recipeId: "r1", ingredientId: "onion", displayName: "玉ねぎ", quantity: 1, unit: "個" },
        ]),
      ],
      [
        "r2",
        recipe("r2", [
          { id: "l2", recipeId: "r2", ingredientId: "onion", displayName: "玉ねぎ", quantity: 0.5, unit: "個" },
        ]),
      ],
    ]);
    const items = aggregateShoppingList({
      slots: [{ recipeId: "r1" }, { recipeId: "r2" }],
      recipes,
      ingredients: masters,
      householdSize: 2,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      ingredientId: "onion",
      displayName: "玉ねぎ",
      quantity: 1.5,
      unit: "個",
      category: "vegetable",
    });
    expect(items[0]?.sourceRecipeIds.sort()).toEqual(["r1", "r2"]);
  });

  it("scales quantities from recipe servings to household size", () => {
    const recipes = new Map<string, RecipeForShopping>([
      [
        "r1",
        recipe(
          "r1",
          [{ id: "l1", recipeId: "r1", ingredientId: "pork", displayName: "豚こま", quantity: 200, unit: "g" }],
          2,
        ),
      ],
    ]);
    const items = aggregateShoppingList({
      slots: [{ recipeId: "r1" }],
      recipes,
      ingredients: masters,
      householdSize: 4, // scale x2
    });
    expect(items[0]).toMatchObject({ quantity: 400, unit: "g" });
  });

  it("converts and sums within the weight system (kg + g)", () => {
    const recipes = new Map<string, RecipeForShopping>([
      [
        "r1",
        recipe("r1", [
          { id: "l1", recipeId: "r1", ingredientId: "pork", displayName: "豚こま", quantity: 1, unit: "kg" },
          { id: "l2", recipeId: "r1", ingredientId: "pork", displayName: "豚こま", quantity: 200, unit: "g" },
        ]),
      ],
    ]);
    const items = aggregateShoppingList({
      slots: [{ recipeId: "r1" }],
      recipes,
      ingredients: masters,
      householdSize: 2,
    });
    expect(items[0]).toMatchObject({ quantity: 1200, unit: "g" });
  });

  it("excludes pantry staples by default and includes them when requested", () => {
    const recipes = new Map<string, RecipeForShopping>([
      [
        "r1",
        recipe("r1", [
          { id: "l1", recipeId: "r1", ingredientId: "soy", displayName: "醤油", quantity: 1, unit: "大さじ" },
        ]),
      ],
    ]);
    const base = {
      slots: [{ recipeId: "r1" }],
      recipes,
      ingredients: masters,
      householdSize: 2,
    };
    expect(aggregateShoppingList(base)).toHaveLength(0);
    const withStaples = aggregateShoppingList({ ...base, includePantryStaples: true });
    expect(withStaples[0]).toMatchObject({ quantity: 15, unit: "ml", category: "seasoning" });
  });

  it("records ambiguous quantities as a note instead of summing them", () => {
    const recipes = new Map<string, RecipeForShopping>([
      [
        "r1",
        recipe("r1", [
          { id: "l1", recipeId: "r1", ingredientId: "onion", displayName: "長ねぎ", quantity: 1, unit: "本" },
          { id: "l2", recipeId: "r1", ingredientId: "onion", displayName: "長ねぎ", quantity: null, unit: null, isAmbiguous: true },
        ]),
      ],
    ]);
    const items = aggregateShoppingList({
      slots: [{ recipeId: "r1" }],
      recipes,
      ingredients: masters,
      householdSize: 2,
    });
    expect(items[0]).toMatchObject({ quantity: 1, unit: "本", ambiguousNote: "適量" });
  });

  it("sorts items by store-aisle category order", () => {
    const recipes = new Map<string, RecipeForShopping>([
      [
        "r1",
        recipe("r1", [
          { id: "l1", recipeId: "r1", ingredientId: "pork", displayName: "豚こま", quantity: 100, unit: "g" },
          { id: "l2", recipeId: "r1", ingredientId: "onion", displayName: "玉ねぎ", quantity: 1, unit: "個" },
          { id: "l3", recipeId: "r1", ingredientId: "soy", displayName: "醤油", quantity: 1, unit: "大さじ" },
        ]),
      ],
    ]);
    const items = aggregateShoppingList({
      slots: [{ recipeId: "r1" }],
      recipes,
      ingredients: masters,
      householdSize: 2,
      includePantryStaples: true,
    });
    expect(items.map((i) => i.category)).toEqual(["vegetable", "meat", "seasoning"]);
  });

  it("ignores slots with no assigned recipe", () => {
    const items = aggregateShoppingList({
      slots: [{ recipeId: null }],
      recipes: new Map(),
      ingredients: masters,
      householdSize: 2,
    });
    expect(items).toEqual([]);
  });
});
