/**
 * 開発用のサンプルデータ投入。抽出パイプラインが未実装のため、手元で
 * 献立生成・買い物リストを動かせるように最小限のレシピ群を用意する。
 */

import { db } from "./schema.ts";
import type {
  IngredientRow,
  RecipeIngredientRow,
  RecipeRow,
  SourceRow,
} from "./schema.ts";
import { today } from "../lib/date.ts";

const now = () => new Date().toISOString();

const sources: SourceRow[] = [
  {
    id: "src-ryuji",
    name: "リュウジのバズレシピ (YouTube)",
    kind: "youtube",
    identifier: "ryuji",
    icon_url: null,
    is_enabled: true,
    created_at: now(),
  },
  {
    id: "src-web",
    name: "delishkitchen.tv",
    kind: "web",
    identifier: "delishkitchen.tv",
    icon_url: null,
    is_enabled: true,
    created_at: now(),
  },
];

const ing = (
  id: string,
  name: string,
  category: IngredientRow["category"],
  isPantry = false,
): IngredientRow => ({
  id,
  canonical_name: name,
  kana: null,
  aliases: [],
  category,
  default_unit: null,
  is_pantry_staple: isPantry,
  sort_order: 0,
});

const ingredients: IngredientRow[] = [
  ing("ing-onion", "玉ねぎ", "vegetable"),
  ing("ing-carrot", "にんじん", "vegetable"),
  ing("ing-negi", "長ねぎ", "vegetable"),
  ing("ing-cabbage", "キャベツ", "vegetable"),
  ing("ing-potato", "じゃがいも", "vegetable"),
  ing("ing-pork", "豚こま切れ肉", "meat"),
  ing("ing-chicken", "鶏もも肉", "meat"),
  ing("ing-beef", "牛こま切れ肉", "meat"),
  ing("ing-tofu", "豆腐", "dairy_egg"),
  ing("ing-egg", "卵", "dairy_egg"),
  ing("ing-soy", "醤油", "seasoning", true),
  ing("ing-mirin", "みりん", "seasoning", true),
  ing("ing-oyster", "オイスターソース", "seasoning"),
  ing("ing-sugar", "砂糖", "seasoning", true),
];

let recipeSeq = 0;
let lineSeq = 0;
const recipeRows: RecipeRow[] = [];
const lineRows: RecipeIngredientRow[] = [];

/** レシピ + 材料をまとめて登録するヘルパー。 */
function recipe(
  partial: Partial<RecipeRow> & {
    title: string;
    dish_roles: RecipeRow["dish_roles"];
  },
  lines: Array<
    Partial<RecipeIngredientRow> & { ingredient_id: string; display_name: string }
  >,
): void {
  const id = `rcp-${++recipeSeq}`;
  recipeRows.push({
    id,
    source_id: partial.source_id ?? "src-ryuji",
    title: partial.title,
    source_url: partial.source_url ?? null,
    thumbnail_url: null,
    dish_roles: partial.dish_roles,
    cook_time_min: partial.cook_time_min ?? 20,
    servings: partial.servings ?? 2,
    main_ingredient_category: partial.main_ingredient_category ?? null,
    cooking_method: partial.cooking_method ?? null,
    tags: partial.tags ?? [],
    is_favorite: partial.is_favorite ?? false,
    is_excluded: false,
    cook_count: partial.cook_count ?? 0,
    last_cooked_at: partial.last_cooked_at ?? null,
    reject_count: 0,
    created_at: now(),
    updated_at: now(),
  });
  for (const l of lines) {
    lineRows.push({
      id: `line-${++lineSeq}`,
      recipe_id: id,
      ingredient_id: l.ingredient_id,
      raw_text: l.raw_text ?? `${l.display_name} ${l.quantity ?? ""}${l.unit ?? ""}`,
      display_name: l.display_name,
      quantity: l.quantity ?? null,
      unit: l.unit ?? null,
      is_ambiguous: l.is_ambiguous ?? false,
      position: lineRows.length,
    });
  }
}

// --- 主菜 ---
recipe(
  { title: "豚の生姜焼き", dish_roles: ["main"], main_ingredient_category: "pork", cooking_method: "fry", cook_time_min: 20, is_favorite: true, tags: ["時短"] },
  [
    { ingredient_id: "ing-pork", display_name: "豚こま切れ肉", quantity: 300, unit: "g" },
    { ingredient_id: "ing-onion", display_name: "玉ねぎ", quantity: 1, unit: "個" },
    { ingredient_id: "ing-soy", display_name: "醤油", quantity: 2, unit: "大さじ" },
    { ingredient_id: "ing-mirin", display_name: "みりん", quantity: 2, unit: "大さじ" },
  ],
);
recipe(
  { title: "鶏の唐揚げ", dish_roles: ["main"], main_ingredient_category: "chicken", cooking_method: "fry", cook_time_min: 30 },
  [
    { ingredient_id: "ing-chicken", display_name: "鶏もも肉", quantity: 2, unit: "枚" },
    { ingredient_id: "ing-soy", display_name: "醤油", quantity: 1, unit: "大さじ" },
    { ingredient_id: "ing-egg", display_name: "卵", quantity: 1, unit: "個" },
  ],
);
recipe(
  { title: "肉じゃが", dish_roles: ["main", "side"], main_ingredient_category: "beef", cooking_method: "simmer", cook_time_min: 40, source_id: "src-web" },
  [
    { ingredient_id: "ing-beef", display_name: "牛こま切れ肉", quantity: 200, unit: "g" },
    { ingredient_id: "ing-potato", display_name: "じゃがいも", quantity: 3, unit: "個" },
    { ingredient_id: "ing-carrot", display_name: "にんじん", quantity: 1, unit: "本" },
    { ingredient_id: "ing-onion", display_name: "玉ねぎ", quantity: 1, unit: "個" },
    { ingredient_id: "ing-soy", display_name: "醤油", quantity: 3, unit: "大さじ" },
  ],
);
recipe(
  { title: "麻婆豆腐", dish_roles: ["main"], main_ingredient_category: "pork", cooking_method: "fry", cook_time_min: 25, source_id: "src-web" },
  [
    { ingredient_id: "ing-tofu", display_name: "豆腐", quantity: 1, unit: "丁" },
    { ingredient_id: "ing-pork", display_name: "豚ひき肉", quantity: 150, unit: "g" },
    { ingredient_id: "ing-negi", display_name: "長ねぎ", quantity: 1, unit: "本" },
    { ingredient_id: "ing-oyster", display_name: "オイスターソース", quantity: 2, unit: "大さじ" },
  ],
);
recipe(
  { title: "鶏の照り焼き", dish_roles: ["main"], main_ingredient_category: "chicken", cooking_method: "grill", cook_time_min: 25 },
  [
    { ingredient_id: "ing-chicken", display_name: "鶏もも肉", quantity: 2, unit: "枚" },
    { ingredient_id: "ing-soy", display_name: "醤油", quantity: 2, unit: "大さじ" },
    { ingredient_id: "ing-sugar", display_name: "砂糖", quantity: 1, unit: "大さじ" },
  ],
);
recipe(
  { title: "回鍋肉", dish_roles: ["main"], main_ingredient_category: "pork", cooking_method: "fry", cook_time_min: 20 },
  [
    { ingredient_id: "ing-pork", display_name: "豚こま切れ肉", quantity: 250, unit: "g" },
    { ingredient_id: "ing-cabbage", display_name: "キャベツ", quantity: 0.25, unit: "個" },
    { ingredient_id: "ing-oyster", display_name: "オイスターソース", quantity: 1, unit: "大さじ" },
  ],
);

// --- 副菜 ---
recipe(
  { title: "きんぴらごぼう", dish_roles: ["side"], main_ingredient_category: "vegetable", cooking_method: "fry", cook_time_min: 15, source_id: "src-web" },
  [
    { ingredient_id: "ing-carrot", display_name: "にんじん", quantity: 0.5, unit: "本" },
    { ingredient_id: "ing-soy", display_name: "醤油", quantity: 1, unit: "大さじ" },
  ],
);
recipe(
  { title: "無限キャベツ", dish_roles: ["side"], main_ingredient_category: "vegetable", cooking_method: "raw", cook_time_min: 10, is_favorite: true },
  [
    { ingredient_id: "ing-cabbage", display_name: "キャベツ", quantity: 0.25, unit: "個" },
  ],
);
recipe(
  { title: "だし巻き卵", dish_roles: ["side"], main_ingredient_category: "egg", cooking_method: "fry", cook_time_min: 10 },
  [
    { ingredient_id: "ing-egg", display_name: "卵", quantity: 3, unit: "個" },
  ],
);
recipe(
  { title: "冷奴", dish_roles: ["side"], main_ingredient_category: "vegetable", cooking_method: "raw", cook_time_min: 5 },
  [
    { ingredient_id: "ing-tofu", display_name: "豆腐", quantity: 1, unit: "丁" },
    { ingredient_id: "ing-negi", display_name: "長ねぎ", quantity: null, unit: null, is_ambiguous: true },
  ],
);
recipe(
  { title: "ポテトサラダ", dish_roles: ["side"], main_ingredient_category: "vegetable", cooking_method: "raw", cook_time_min: 20 },
  [
    { ingredient_id: "ing-potato", display_name: "じゃがいも", quantity: 3, unit: "個" },
    { ingredient_id: "ing-carrot", display_name: "にんじん", quantity: 0.5, unit: "本" },
  ],
);

/**
 * サンプルデータを Dexie に投入する（既存データは全消去してから入れ直す）。
 *
 * @returns 投入したレシピ件数
 */
export async function seedSampleData(): Promise<number> {
  await db.transaction(
    "rw",
    db.sources,
    db.ingredients,
    db.recipes,
    db.recipeIngredients,
    async () => {
      await Promise.all([
        db.sources.clear(),
        db.ingredients.clear(),
        db.recipes.clear(),
        db.recipeIngredients.clear(),
      ]);
      await db.sources.bulkAdd(sources);
      await db.ingredients.bulkAdd(ingredients);
      await db.recipes.bulkAdd(recipeRows);
      await db.recipeIngredients.bulkAdd(lineRows);
    },
  );
  return recipeRows.length;
}

/** 参考用: サンプルの週開始日（今日を含む週の月曜）。 */
export const sampleWeekStart = today();
