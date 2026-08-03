/**
 * 手動レシピ登録の保存ロジック（US-02）。
 *
 * フォーム入力を Dexie に書き込む。食材は既存マスタに照合し、未ヒットなら新規マスタを
 * 作成する（正規化は core の {@link normalizeIngredientName} 経由、§5.3 の簡易版）。
 *
 * 抽出パイプライン未実装のため、これが実データを増やす当面の主経路になる。
 */

import type {
  CookingMethod,
  DishRole,
  IngredientCategory,
} from "@recipe-planner/core";
import {
  db,
  type IngredientRow,
  type RecipeIngredientRow,
  type RecipeRow,
  type SourceRow,
} from "../db/schema.ts";
import { matchMaster } from "./ingredients.ts";

/** フォームの 1 材料行。 */
export interface RecipeFormIngredient {
  displayName: string;
  quantity: number | null;
  unit: string | null;
  isAmbiguous: boolean;
  /** 新規食材のときに付与するカテゴリ（既存マスタに一致した場合は無視される）。 */
  newCategory: IngredientCategory;
}

/** 手動登録フォームの入力全体。 */
export interface RecipeFormData {
  title: string;
  dishRoles: DishRole[];
  cookTimeMin: number | null;
  servings: number;
  mainIngredientCategory: string | null;
  cookingMethod: CookingMethod | null;
  tags: string[];
  sourceUrl: string | null;
  isFavorite: boolean;
  ingredients: RecipeFormIngredient[];
}

/** 手動登録レシピが属する擬似ソース。 */
const MANUAL_SOURCE: SourceRow = {
  id: "src-manual",
  name: "手動入力",
  kind: "manual",
  identifier: "manual",
  icon_url: null,
  is_enabled: true,
  created_at: "",
};

/** 入力の妥当性を検証し、問題があればメッセージ配列を返す（空なら OK）。 */
export function validateRecipeForm(data: RecipeFormData): string[] {
  const errors: string[] = [];
  if (data.title.trim() === "") errors.push("料理名を入力してください。");
  if (data.dishRoles.length === 0) errors.push("料理の役割を 1 つ以上選んでください。");
  if (data.servings <= 0) errors.push("人数は 1 以上にしてください。");
  const hasIngredient = data.ingredients.some((i) => i.displayName.trim() !== "");
  if (!hasIngredient) errors.push("材料を 1 つ以上入力してください。");
  return errors;
}

const uuid = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

/**
 * 手動入力レシピを Dexie に保存する。
 *
 * 食材は既存マスタに照合し、未ヒット分は新規マスタとして同時に作成する。すべて 1 つの
 * トランザクションで書き込む。
 *
 * @returns 作成されたレシピの ID
 */
export async function saveManualRecipe(data: RecipeFormData): Promise<string> {
  const recipeId = uuid();
  const masters = await db.ingredients.toArray();
  const newMasters: IngredientRow[] = [];

  const lines: RecipeIngredientRow[] = [];
  data.ingredients
    .filter((i) => i.displayName.trim() !== "")
    .forEach((line, index) => {
      const name = line.displayName.trim();
      let master = matchMaster(name, [...masters, ...newMasters]);
      if (!master) {
        // 未ヒット → 新規マスタを作成（§5.3: 確度が低ければ新規登録し後で統合を提案）。
        master = {
          id: uuid(),
          canonical_name: name,
          kana: null,
          aliases: [],
          category: line.newCategory,
          default_unit: line.unit,
          is_pantry_staple: false,
          sort_order: 0,
        };
        newMasters.push(master);
      }
      const ambiguous = line.isAmbiguous || line.quantity === null;
      lines.push({
        id: uuid(),
        recipe_id: recipeId,
        ingredient_id: master.id,
        raw_text: `${name} ${line.quantity ?? ""}${line.unit ?? ""}`.trim(),
        display_name: name,
        quantity: ambiguous ? null : line.quantity,
        unit: line.unit,
        is_ambiguous: ambiguous,
        position: index,
      });
    });

  const recipe: RecipeRow = {
    id: recipeId,
    source_id: MANUAL_SOURCE.id,
    title: data.title.trim(),
    source_url: data.sourceUrl?.trim() || null,
    thumbnail_url: null,
    dish_roles: data.dishRoles,
    cook_time_min: data.cookTimeMin,
    servings: data.servings,
    main_ingredient_category: data.mainIngredientCategory?.trim() || null,
    cooking_method: data.cookingMethod,
    tags: data.tags,
    is_favorite: data.isFavorite,
    is_excluded: false,
    cook_count: 0,
    last_cooked_at: null,
    reject_count: 0,
    created_at: now(),
    updated_at: now(),
  };

  await db.transaction(
    "rw",
    db.sources,
    db.ingredients,
    db.recipes,
    db.recipeIngredients,
    async () => {
      const existingSource = await db.sources.get(MANUAL_SOURCE.id);
      if (!existingSource) await db.sources.put({ ...MANUAL_SOURCE, created_at: now() });
      if (newMasters.length > 0) await db.ingredients.bulkAdd(newMasters);
      await db.recipes.add(recipe);
      if (lines.length > 0) await db.recipeIngredients.bulkAdd(lines);
    },
  );

  return recipeId;
}
