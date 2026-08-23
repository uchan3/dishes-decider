/**
 * レシピライブラリの検索・絞り込み・並べ替え（仕様書 F-01-3）。
 *
 * 照合は core の {@link normalizeIngredientName}（NFKC → ひらがな化 → 空白除去 → 小文字化）
 * を通す。「トマト」で「とまと」が、「玉ねぎ」で「玉ねぎ 1個」がヒットしてほしいため、
 * 単純な `includes` では不十分。材料名も検索対象にするのは、
 * 「冷蔵庫の鶏むね肉を使いたい」という探し方が実際の使い方だから。
 */

import { normalizeIngredientName } from "@recipe-planner/core";
import type { DishRole } from "@recipe-planner/core";
import type { RecipeRow } from "../db/schema.ts";

/** 並べ替えの軸。 */
export type RecipeSort = "recent" | "title" | "last_cooked" | "cook_count" | "pantry";

/** 検索対象の 1 件（レシピ＋その材料名＋冷蔵庫との突き合わせ）。 */
export interface RecipeSearchEntry {
  recipe: RecipeRow;
  /** このレシピの材料の表示名。 */
  ingredientNames: readonly string[];
  /** 在庫適合度 `[0, 1]`（docs/pantry.md §7）。冷蔵庫が空なら 0。 */
  pantryScore?: number;
  /** 足りない材料の数（「あと N 品」）。突き合わせ対象が無ければ undefined。 */
  missing?: number;
}

/** 絞り込み条件。 */
export interface RecipeFilter {
  /** タイトル・材料名・タグへの部分一致（空なら絞り込まない）。 */
  query: string;
  /** 料理の役割。`all` なら絞り込まない。 */
  role: DishRole | "all";
  /** 収集元。`all` なら絞り込まない。 */
  sourceId: string | "all";
  /** 調理時間の上限（分）。null なら絞り込まない。時間が不明なレシピは残す。 */
  maxCookMin: number | null;
  /** 「あと N 品」の上限。null なら絞り込まない（docs/pantry.md §7）。 */
  maxMissing: number | null;
  /** お気に入りのみ。 */
  favoritesOnly: boolean;
  sort: RecipeSort;
}

/** 既定の絞り込み条件（何も絞らず、新しい順）。 */
export const DEFAULT_RECIPE_FILTER: RecipeFilter = {
  query: "",
  role: "all",
  sourceId: "all",
  maxCookMin: null,
  maxMissing: null,
  favoritesOnly: false,
  sort: "recent",
};

/** null を常に後ろに送る比較（未調理のレシピを最終調理日ソートの末尾に置く）。 */
function compareNullableDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

function compare(
  a: RecipeSearchEntry,
  b: RecipeSearchEntry,
  sort: RecipeSort,
): number {
  if (sort === "pantry") {
    // 在庫で作れる順。同点なら「あと N 品」が少ない順（材料が少ないレシピを優先）。
    const byScore = (b.pantryScore ?? 0) - (a.pantryScore ?? 0);
    if (byScore !== 0) return byScore;
    return (a.missing ?? Number.MAX_SAFE_INTEGER) - (b.missing ?? Number.MAX_SAFE_INTEGER);
  }
  return compareRecipes(a.recipe, b.recipe, sort);
}

function compareRecipes(a: RecipeRow, b: RecipeRow, sort: RecipeSort): number {
  switch (sort) {
    case "title":
      return a.title.localeCompare(b.title, "ja");
    case "last_cooked":
      return compareNullableDesc(a.last_cooked_at, b.last_cooked_at);
    case "cook_count":
      return b.cook_count - a.cook_count;
    case "recent":
    default:
      return compareNullableDesc(a.created_at, b.created_at);
  }
}

/**
 * 条件に合うレシピを返す（純粋関数）。
 *
 * @param entries - レシピと材料名の組
 * @param filter - 絞り込み条件
 *
 * @example
 * ```ts
 * filterRecipes(entries, { ...DEFAULT_RECIPE_FILTER, query: "とりむね" });
 * // → 材料に「鶏むね肉」を含むレシピもヒットする
 * ```
 */
export function filterRecipes(
  entries: readonly RecipeSearchEntry[],
  filter: RecipeFilter,
): RecipeRow[] {
  const key = normalizeIngredientName(filter.query);

  const matched = entries.filter((entry) => {
    const { recipe, ingredientNames } = entry;
    // 「あと N 品」で絞る。突き合わせ対象が無いレシピ（材料が未紐付け等）は落とさない。
    if (filter.maxMissing !== null && entry.missing !== undefined) {
      if (entry.missing > filter.maxMissing) return false;
    }
    if (filter.favoritesOnly && !recipe.is_favorite) return false;
    if (filter.role !== "all" && !recipe.dish_roles.includes(filter.role)) return false;
    if (filter.sourceId !== "all" && recipe.source_id !== filter.sourceId) return false;
    // 調理時間が不明なレシピは落とさない（取り込みで取れないことがあり、
    // 落とすと「30 分以内」で候補がごっそり消えるため）。
    if (
      filter.maxCookMin !== null &&
      recipe.cook_time_min !== null &&
      recipe.cook_time_min > filter.maxCookMin
    ) {
      return false;
    }
    if (key === "") return true;

    const haystack = [recipe.title, ...recipe.tags, ...ingredientNames];
    return haystack.some((text) => normalizeIngredientName(text).includes(key));
  });

  return [...matched].sort((a, b) => compare(a, b, filter.sort)).map((e) => e.recipe);
}
