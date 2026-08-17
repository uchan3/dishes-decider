import { describe, expect, it } from "vitest";
import type { RecipeRow } from "../db/schema.ts";
import {
  DEFAULT_RECIPE_FILTER,
  filterRecipes,
  type RecipeSearchEntry,
} from "./recipeSearch.ts";

const recipe = (partial: Partial<RecipeRow> = {}): RecipeRow => ({
  id: "r1",
  source_id: null,
  title: "肉じゃが",
  source_url: null,
  thumbnail_url: null,
  dish_roles: ["main"],
  cook_time_min: 40,
  servings: 2,
  main_ingredient_category: null,
  cooking_method: null,
  tags: [],
  is_favorite: false,
  is_excluded: false,
  cook_count: 0,
  last_cooked_at: null,
  reject_count: 0,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  ...partial,
});

const entry = (r: RecipeRow, ingredientNames: string[] = []): RecipeSearchEntry => ({
  recipe: r,
  ingredientNames,
});

const nikujaga = recipe({ id: "r1", title: "肉じゃが", created_at: "2026-08-01T00:00:00.000Z" });
const karaage = recipe({
  id: "r2",
  title: "鶏の唐揚げ",
  dish_roles: ["main"],
  tags: ["がっつり"],
  is_favorite: true,
  cook_count: 5,
  last_cooked_at: "2026-08-10",
  created_at: "2026-08-05T00:00:00.000Z",
});
const salad = recipe({
  id: "r3",
  title: "ポテトサラダ",
  dish_roles: ["side"],
  cook_count: 2,
  last_cooked_at: "2026-08-14",
  created_at: "2026-08-03T00:00:00.000Z",
});

const entries: RecipeSearchEntry[] = [
  entry(nikujaga, ["豚こま切れ肉", "じゃがいも", "玉ねぎ"]),
  entry(karaage, ["鶏もも肉", "醤油"]),
  entry(salad, ["じゃがいも", "きゅうり"]),
];

const ids = (rows: RecipeRow[]) => rows.map((r) => r.id);

describe("filterRecipes", () => {
  it("returns everything, newest first, with the default filter", () => {
    expect(ids(filterRecipes(entries, DEFAULT_RECIPE_FILTER))).toEqual(["r2", "r3", "r1"]);
  });

  it("matches on the title", () => {
    const rows = filterRecipes(entries, { ...DEFAULT_RECIPE_FILTER, query: "唐揚げ" });
    expect(ids(rows)).toEqual(["r2"]);
  });

  it("matches on ingredient names", () => {
    const rows = filterRecipes(entries, { ...DEFAULT_RECIPE_FILTER, query: "じゃがいも" });
    expect(ids(rows)).toEqual(["r3", "r1"]);
  });

  it("matches on tags", () => {
    expect(ids(filterRecipes(entries, { ...DEFAULT_RECIPE_FILTER, query: "がっつり" }))).toEqual([
      "r2",
    ]);
  });

  it("ignores kana form and spacing when matching", () => {
    // 「鶏もも肉」を「とりもも」では引けない（漢字は辞書が要る）が、カナ違いは吸収する。
    const rows = filterRecipes(entries, { ...DEFAULT_RECIPE_FILTER, query: "キュウリ" });
    expect(ids(rows)).toEqual(["r3"]);
    const spaced = filterRecipes(entries, { ...DEFAULT_RECIPE_FILTER, query: " ポテト サラダ " });
    expect(ids(spaced)).toEqual(["r3"]);
  });

  it("filters by dish role and favorites", () => {
    expect(ids(filterRecipes(entries, { ...DEFAULT_RECIPE_FILTER, role: "side" }))).toEqual(["r3"]);
    expect(ids(filterRecipes(entries, { ...DEFAULT_RECIPE_FILTER, favoritesOnly: true }))).toEqual([
      "r2",
    ]);
  });

  it("combines a query with the other filters", () => {
    const rows = filterRecipes(entries, {
      ...DEFAULT_RECIPE_FILTER,
      query: "じゃがいも",
      role: "main",
    });
    expect(ids(rows)).toEqual(["r1"]);
  });

  it("sorts by title, cook count and last cooked date", () => {
    expect(ids(filterRecipes(entries, { ...DEFAULT_RECIPE_FILTER, sort: "cook_count" }))).toEqual([
      "r2",
      "r3",
      "r1",
    ]);
    // 未調理 (null) は最後に置く。
    expect(ids(filterRecipes(entries, { ...DEFAULT_RECIPE_FILTER, sort: "last_cooked" }))).toEqual([
      "r3",
      "r2",
      "r1",
    ]);
    // 日本語の照合順（ポテトサラダ → 鶏の唐揚げ → 肉じゃが）。
    expect(ids(filterRecipes(entries, { ...DEFAULT_RECIPE_FILTER, sort: "title" }))).toEqual([
      "r3",
      "r2",
      "r1",
    ]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterRecipes(entries, { ...DEFAULT_RECIPE_FILTER, query: "パスタ" })).toEqual([]);
  });
});

describe("filterRecipes（ソース・調理時間）", () => {
  const fromYoutube = recipe({
    id: "y1",
    title: "リュウジの一品",
    source_id: "src-ryuji",
    cook_time_min: 10,
  });
  const unknownTime = recipe({ id: "u1", title: "時間未設定", cook_time_min: null });
  const withSource: RecipeSearchEntry[] = [
    entry(nikujaga), // 40 分・source なし
    entry(karaage), // 30 分・source なし
    entry(fromYoutube),
    entry(unknownTime),
  ];

  it("filters by source", () => {
    const rows = filterRecipes(withSource, { ...DEFAULT_RECIPE_FILTER, sourceId: "src-ryuji" });
    expect(ids(rows)).toEqual(["y1"]);
  });

  it("filters by cook time but keeps recipes with an unknown time", () => {
    const rows = filterRecipes(withSource, { ...DEFAULT_RECIPE_FILTER, maxCookMin: 30 });
    // 40 分のもの（肉じゃが・唐揚げ）が落ちる。時間不明の u1 は残す。
    expect(ids(rows).sort()).toEqual(["u1", "y1"]);
  });

  it("combines source and cook time with the query", () => {
    const rows = filterRecipes(withSource, {
      ...DEFAULT_RECIPE_FILTER,
      query: "リュウジ",
      maxCookMin: 15,
    });
    expect(ids(rows)).toEqual(["y1"]);
  });
});
