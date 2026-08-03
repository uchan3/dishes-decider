/**
 * テスト専用のファクトリ。公開 API（index.ts）には含めない。
 *
 * 各テストが必要なフィールドだけを上書きできるよう、全項目に無難な既定値を与える。
 */

import type {
  DishRole,
  Ingredient,
  IngredientCategory,
  Recipe,
  RecipeIngredient,
} from "./types/index.ts";

/** 既定値を持つ {@link Recipe} を生成する。 */
export function makeRecipe(overrides: Partial<Recipe> & { id: string }): Recipe {
  return {
    sourceId: null,
    title: `recipe-${overrides.id}`,
    dishRoles: ["main"] as DishRole[],
    cookTimeMin: 20,
    servings: 2,
    mainIngredientCategory: null,
    cookingMethod: null,
    tags: [],
    isFavorite: false,
    isExcluded: false,
    cookCount: 0,
    lastCookedAt: null,
    rejectCount: 0,
    ...overrides,
  };
}

/** 既定値を持つ {@link RecipeIngredient} を生成する。 */
export function makeIngredientLine(
  overrides: Partial<RecipeIngredient> & { id: string; recipeId: string },
): RecipeIngredient {
  return {
    ingredientId: null,
    displayName: "食材",
    rawText: "食材 適量",
    quantity: null,
    unit: null,
    isAmbiguous: false,
    ...overrides,
  };
}

/** 既定値を持つ食材マスタ {@link Ingredient} を生成する。 */
export function makeMaster(
  overrides: Partial<Ingredient> & { id: string },
): Ingredient {
  return {
    canonicalName: `master-${overrides.id}`,
    category: "other" as IngredientCategory,
    isPantryStaple: false,
    sortOrder: 0,
    ...overrides,
  };
}
