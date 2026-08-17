/**
 * Dexie (IndexedDB) スキーマ。ローカルの正データであり、UI はここから読む。
 *
 * 設計方針（architecture.md §5）:
 *   - 行は snake_case で保持し、Supabase (Postgres) との同期を 1:1 にする。
 *   - core のドメイン型 (camelCase) への変換は `mappers.ts` の責務。
 *   - 書き込みは `outbox` にも積み、オンライン復帰時に Supabase へフラッシュする。
 *
 * 注意: IndexedDB は boolean をキーにできないため、`is_checked` 等は
 * インデックスに含めずメモリ側でフィルタする（architecture.md のスキーマからの調整点）。
 */

import Dexie, { type EntityTable } from "dexie";
import type {
  CookingMethod,
  DishRole,
  IngredientCategory,
  MealType,
} from "@recipe-planner/core";

/** 収集元。 */
export interface SourceRow {
  id: string;
  name: string;
  kind: "youtube" | "instagram" | "web" | "manual";
  identifier: string;
  icon_url: string | null;
  is_enabled: boolean;
  created_at: string;
}

/** 正規化食材マスタ。 */
export interface IngredientRow {
  id: string;
  canonical_name: string;
  kana: string | null;
  aliases: string[];
  category: IngredientCategory;
  default_unit: string | null;
  is_pantry_staple: boolean;
  sort_order: number;
}

/** レシピ（手順原文は保持しない）。 */
export interface RecipeRow {
  id: string;
  source_id: string | null;
  title: string;
  source_url: string | null;
  thumbnail_url: string | null;
  dish_roles: DishRole[];
  cook_time_min: number | null;
  servings: number;
  main_ingredient_category: string | null;
  cooking_method: CookingMethod | null;
  tags: string[];
  is_favorite: boolean;
  is_excluded: boolean;
  cook_count: number;
  last_cooked_at: string | null;
  reject_count: number;
  created_at: string;
  updated_at: string;
}

/** レシピ材料。 */
export interface RecipeIngredientRow {
  id: string;
  recipe_id: string;
  ingredient_id: string | null;
  raw_text: string;
  display_name: string;
  quantity: number | null;
  unit: string | null;
  is_ambiguous: boolean;
  position: number;
}

/** 週間献立（meals / slots は入れ子で保持）。 */
export interface MealPlanRow {
  id: string;
  start_date: string;
  status: "draft" | "confirmed" | "archived";
  meals: MealRow[];
  created_at: string;
  updated_at: string;
}

export interface MealRow {
  id: string;
  date: string;
  meal_type: MealType;
  template_id: string | null;
  is_skipped: boolean;
  slots: PlanSlotRow[];
}

export interface PlanSlotRow {
  id: string;
  dish_role: DishRole;
  recipe_id: string | null;
  is_locked: boolean;
  position: number;
  /**
   * 実際に作った日 (YYYY-MM-DD)。未調理なら null。
   * この列を足す前に保存されたスロットには存在しないため、読むときは `?? null` で扱う
   * （非インデックス列なので Dexie のバージョン更新は不要）。
   */
  cooked_at?: string | null;
}

/** 買い物リスト項目。 */
export interface ShoppingItemRow {
  id: string;
  shopping_list_id: string;
  meal_plan_id: string;
  ingredient_id: string | null;
  display_name: string;
  quantity: number | null;
  unit: string | null;
  ambiguous_note: string | null;
  category: IngredientCategory;
  is_checked: boolean;
  is_manual: boolean;
  source_recipe_ids: string[];
  position: number;
  /**
   * この項目を最後に変更した時刻。端末間マージでチェック状態の新しい方を選ぶのに使う
   * （非インデックス列なので Dexie のバージョン更新は不要）。
   */
  updated_at?: string;
}

/** オフライン同期の送信キュー（outbox パターン）。 */
export interface OutboxRow {
  seq?: number;
  table_name: string;
  record_id: string;
  op: "put" | "delete";
  created_at: string;
}

/** アプリ設定の汎用キー・バリュー行（曜日別テンプレ・世帯人数など）。 */
export interface SettingRow {
  key: string;
  value: unknown;
}

/** アプリの Dexie データベース。 */
export class AppDatabase extends Dexie {
  sources!: EntityTable<SourceRow, "id">;
  ingredients!: EntityTable<IngredientRow, "id">;
  recipes!: EntityTable<RecipeRow, "id">;
  recipeIngredients!: EntityTable<RecipeIngredientRow, "id">;
  mealPlans!: EntityTable<MealPlanRow, "id">;
  shoppingItems!: EntityTable<ShoppingItemRow, "id">;
  outbox!: EntityTable<OutboxRow, "seq">;
  settings!: EntityTable<SettingRow, "key">;

  constructor() {
    super("recipe-planner");
    this.version(1).stores({
      sources: "id, kind, identifier",
      ingredients: "id, canonical_name, category",
      recipes: "id, source_id, *dish_roles, last_cooked_at",
      recipeIngredients: "id, recipe_id, ingredient_id",
      mealPlans: "id, start_date",
      shoppingItems: "id, shopping_list_id, meal_plan_id, category",
      outbox: "++seq, table_name, record_id, created_at",
    });
    // v2: アプリ設定用のキー・バリューストアを追加。
    this.version(2).stores({
      settings: "key",
    });
  }
}

/** アプリ全体で共有する単一の DB インスタンス。 */
export const db = new AppDatabase();
