/**
 * Dexie の行 (snake_case) と core のドメイン型 (camelCase) の相互変換。
 *
 * 永続化層とドメイン層の境界。core は snake_case を一切知らない。
 */

import type {
  Ingredient,
  Recipe,
  RecipeIngredient,
} from "@recipe-planner/core";
import type { IngredientRow, RecipeIngredientRow, RecipeRow } from "./schema.ts";

/** レシピ行 → ドメイン Recipe。 */
export function toRecipe(row: RecipeRow): Recipe {
  return {
    id: row.id,
    sourceId: row.source_id,
    title: row.title,
    dishRoles: row.dish_roles,
    cookTimeMin: row.cook_time_min,
    servings: row.servings,
    mainIngredientCategory: row.main_ingredient_category,
    cookingMethod: row.cooking_method,
    tags: row.tags,
    isFavorite: row.is_favorite,
    isExcluded: row.is_excluded,
    cookCount: row.cook_count,
    lastCookedAt: row.last_cooked_at,
    rejectCount: row.reject_count,
  };
}

/** レシピ材料行 → ドメイン RecipeIngredient。 */
export function toRecipeIngredient(row: RecipeIngredientRow): RecipeIngredient {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    ingredientId: row.ingredient_id,
    displayName: row.display_name,
    rawText: row.raw_text,
    quantity: row.quantity,
    unit: row.unit,
    isAmbiguous: row.is_ambiguous,
  };
}

/** 食材マスタ行 → ドメイン Ingredient。 */
export function toIngredient(row: IngredientRow): Ingredient {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    category: row.category,
    isPantryStaple: row.is_pantry_staple,
    sortOrder: row.sort_order,
  };
}
