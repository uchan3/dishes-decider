/**
 * 手動レシピ登録の保存ロジック（US-02）。
 *
 * フォーム入力を Dexie に書き込む。食材は既存マスタに照合し、未ヒットなら新規マスタを
 * 作成する（照合は core の索引経由、§5.3）。取り込みパイプラインと同じ照合ロジックを
 * 使うため、手動登録と URL 取り込みで同じ食材が別マスタに分かれない。
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
} from "../db/schema.ts";
import { ingredientIndex } from "./ingredients.ts";
import { ensureManualSource } from "./sources.ts";
import { supabase, isSupabaseConfigured } from "./supabase.ts";
import { newId } from "./ids.ts";

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

const uuid = newId;
const now = (): string => new Date().toISOString();

/**
 * 手動入力レシピを保存する。
 *
 * 食材は既存マスタに照合し、未ヒット分は新規マスタとして同時に作成する。
 * Supabase 接続時は **Supabase に書いてから Dexie に書く**（レシピの編集・削除と同じ方針。
 * Dexie だけに書くと他端末に出ず、次回プルでも復元されない）。
 *
 * @param data - フォーム入力
 * @param userId - ログイン中のユーザー ID。null なら Dexie のみに保存する
 * @returns 作成されたレシピの ID
 */
export async function saveManualRecipe(
  data: RecipeFormData,
  userId: string | null = null,
): Promise<string> {
  const recipeId = uuid();
  const source = await ensureManualSource(userId);
  const masterIndex = ingredientIndex(await db.ingredients.toArray());
  const newMasters: IngredientRow[] = [];

  const lines: RecipeIngredientRow[] = [];
  data.ingredients
    .filter((i) => i.displayName.trim() !== "")
    .forEach((line, index) => {
      const name = line.displayName.trim();
      let master = masterIndex.match(name);
      if (!master) {
        // 未ヒット → 新規マスタを作成（§5.3: 確度が低ければ新規登録し後で統合を提案）。
        // 索引にも足して、同じフォーム内に同じ食材が 2 回出ても 1 つに収束させる。
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
        masterIndex.add(master);
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
    source_id: source.id,
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

  // 先に Supabase へ。失敗したら Dexie にも書かず、UI にエラーを出す（食い違いを作らない）。
  if (isSupabaseConfigured && userId !== null) {
    if (newMasters.length > 0) {
      const { error } = await supabase
        .from("ingredients")
        .insert(newMasters.map((m) => ({ ...m, user_id: userId })));
      if (error) throw new Error(`食材マスタの保存に失敗しました: ${error.message}`);
    }
    const { error: recipeErr } = await supabase
      .from("recipes")
      .insert({ ...recipe, user_id: userId });
    if (recipeErr) throw new Error(`レシピの保存に失敗しました: ${recipeErr.message}`);
    if (lines.length > 0) {
      const { error } = await supabase.from("recipe_ingredients").insert(lines);
      if (error) throw new Error(`材料の保存に失敗しました: ${error.message}`);
    }
  }

  await db.transaction("rw", db.ingredients, db.recipes, db.recipeIngredients, async () => {
    if (newMasters.length > 0) await db.ingredients.bulkAdd(newMasters);
    await db.recipes.add(recipe);
    if (lines.length > 0) await db.recipeIngredients.bulkAdd(lines);
  });

  return recipeId;
}
