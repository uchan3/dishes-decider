import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Supabase の代わりに返す行。テストごとに差し替える。 */
const server = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]> }));

// `from(t).select(c).order(...).range(from, to)` だけを満たす最小のスタブ。
// range をちゃんとスライスするので、ページングの検証にも使える。
vi.mock("./supabase.ts", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from(table: string) {
      return {
        select() {
          return {
            order() {
              return {
                range(from: number, to: number) {
                  const all = server.rows[table] ?? [];
                  return Promise.resolve({ data: all.slice(from, to + 1), error: null });
                },
              };
            },
          };
        },
      };
    },
  },
}));

import { db, type RecipeRow } from "../db/schema.ts";
import { idsToDelete, pullLibrary } from "./sync.ts";

const RECIPE_A = "aaaaaaaa-0000-4000-8000-000000000001";
const RECIPE_B = "bbbbbbbb-0000-4000-8000-000000000002";
const LINE_A = "cccccccc-0000-4000-8000-000000000003";
const LINE_B = "dddddddd-0000-4000-8000-000000000004";
const ONION = "eeeeeeee-0000-4000-8000-000000000005";
const SOURCE = "ffffffff-0000-4000-8000-000000000006";

const recipe = (id: string, title: string): RecipeRow => ({
  id,
  source_id: null,
  title,
  source_url: null,
  thumbnail_url: null,
  dish_roles: ["main"],
  cook_time_min: 20,
  servings: 2,
  main_ingredient_category: null,
  cooking_method: null,
  tags: [],
  is_favorite: false,
  is_excluded: false,
  cook_count: 0,
  last_cooked_at: null,
  reject_count: 0,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
});

const line = (id: string, recipeId: string, name: string) => ({
  id,
  recipe_id: recipeId,
  ingredient_id: null,
  raw_text: name,
  display_name: name,
  quantity: 1,
  unit: "個",
  is_ambiguous: false,
  position: 0,
});

/** サーバー側の中身を丸ごと差し替える（指定しないテーブルは空）。 */
function setServer(rows: Record<string, object[]>): void {
  server.rows = {
    sources: [],
    ingredients: [],
    recipes: [],
    recipe_ingredients: [],
    pantry_items: [],
    ...rows,
  } as Record<string, Record<string, unknown>[]>;
}

describe("idsToDelete", () => {
  it("marks rows the server no longer has", () => {
    expect(idsToDelete([RECIPE_A, RECIPE_B], new Set([RECIPE_A]), new Set())).toEqual([RECIPE_B]);
  });

  it("never deletes local-only rows (uuid でない id はサーバーに存在しえない)", () => {
    expect(idsToDelete(["src-manual"], new Set(), new Set())).toEqual([]);
  });

  it("never deletes rows still queued for sending (オフラインで作った行を守る)", () => {
    expect(idsToDelete([RECIPE_A], new Set(), new Set([RECIPE_A]))).toEqual([]);
  });

  it("keeps everything when the server has it all", () => {
    expect(idsToDelete([RECIPE_A], new Set([RECIPE_A]), new Set())).toEqual([]);
  });
});

describe("pullLibrary", () => {
  beforeEach(async () => {
    await Promise.all([
      db.sources.clear(),
      db.ingredients.clear(),
      db.recipes.clear(),
      db.recipeIngredients.clear(),
      db.pantryItems.clear(),
      db.outbox.clear(),
    ]);
    setServer({});
  });

  it("adds rows the server has", async () => {
    setServer({ recipes: [recipe(RECIPE_A, "肉じゃが")] });

    const count = await pullLibrary();

    expect(count).toBe(1);
    expect((await db.recipes.get(RECIPE_A))?.title).toBe("肉じゃが");
  });

  it("removes a recipe the partner deleted, together with its ingredient lines", async () => {
    await db.recipes.bulkPut([recipe(RECIPE_A, "肉じゃが"), recipe(RECIPE_B, "生姜焼き")]);
    await db.recipeIngredients.bulkPut([
      line(LINE_A, RECIPE_A, "じゃがいも"),
      line(LINE_B, RECIPE_B, "豚こま切れ肉"),
    ]);
    // 相手の端末で RECIPE_B を削除した状態。
    setServer({
      recipes: [recipe(RECIPE_A, "肉じゃが")],
      recipe_ingredients: [line(LINE_A, RECIPE_A, "じゃがいも")],
    });

    await pullLibrary();

    expect(await db.recipes.get(RECIPE_B)).toBeUndefined();
    expect(await db.recipeIngredients.get(LINE_B)).toBeUndefined();
    expect(await db.recipes.get(RECIPE_A)).toBeDefined();
  });

  it("removes an ingredient master the partner merged away", async () => {
    await db.ingredients.put({
      id: ONION,
      canonical_name: "玉ねぎ",
      kana: null,
      aliases: [],
      category: "vegetable",
      default_unit: null,
      is_pantry_staple: false,
      sort_order: 0,
    });
    // サーバーに他の行は残っている（全部空だと安全弁が働いて削除しない）。
    setServer({ recipes: [recipe(RECIPE_A, "肉じゃが")] });

    await pullLibrary();

    expect(await db.ingredients.get(ONION)).toBeUndefined();
  });

  it("keeps a recipe that has not been sent yet (オフラインで作った手動レシピ)", async () => {
    await db.recipes.put(recipe(RECIPE_A, "母のカレー"));
    await db.outbox.add({
      table_name: "recipes",
      record_id: RECIPE_A,
      op: "put",
      created_at: new Date().toISOString(),
    });
    // サーバーには別のレシピがある（空応答の安全弁ではなくキュー保護を見る）。
    setServer({ recipes: [recipe(RECIPE_B, "生姜焼き")] });

    await pullLibrary();

    expect(await db.recipes.get(RECIPE_A)).toBeDefined();
  });

  it("keeps the local-only manual source", async () => {
    await db.sources.put({
      id: "src-manual",
      name: "手動登録",
      kind: "manual",
      identifier: "manual",
      icon_url: null,
      is_enabled: true,
      created_at: "2026-09-01T00:00:00.000Z",
    });
    setServer({ sources: [], recipes: [recipe(RECIPE_A, "肉じゃが")] });

    await pullLibrary();

    expect(await db.sources.get("src-manual")).toBeDefined();
  });

  it("mirrors the fridge in both directions", async () => {
    await db.pantryItems.put({ id: ONION, added_at: "2026-09-01T00:00:00.000Z" });
    // 相手が使い切って冷蔵庫から出した状態（ライブラリ自体は残っている）。
    setServer({ recipes: [recipe(RECIPE_A, "肉じゃが")], pantry_items: [] });

    await pullLibrary();

    expect(await db.pantryItems.get(ONION)).toBeUndefined();
  });

  it("keeps a fridge item added offline (以前は clear() で消えていた)", async () => {
    await db.pantryItems.put({ id: ONION, added_at: "2026-09-01T00:00:00.000Z" });
    await db.outbox.add({
      table_name: "pantryItems",
      record_id: ONION,
      op: "put",
      created_at: new Date().toISOString(),
    });
    setServer({ recipes: [recipe(RECIPE_A, "肉じゃが")], pantry_items: [] });

    await pullLibrary();

    expect(await db.pantryItems.get(ONION)).toBeDefined();
  });

  it("does not resurrect a recipe whose deletion has not been sent yet", async () => {
    // オフラインで削除 → キューに delete が残ったまま。サーバーにはまだ在る。
    await db.outbox.add({
      table_name: "recipes",
      record_id: RECIPE_A,
      op: "delete",
      created_at: new Date().toISOString(),
    });
    setServer({ recipes: [recipe(RECIPE_A, "肉じゃが")] });

    await pullLibrary();

    expect(await db.recipes.get(RECIPE_A)).toBeUndefined();
  });


  it("skips deletions when the server answers empty across the board (事故の形をした応答)", async () => {
    // セッション切れ等で全テーブルが空で返ると、素直に反映すればライブラリが全滅する。
    await db.recipes.put(recipe(RECIPE_A, "肉じゃが"));
    await db.ingredients.put({
      id: ONION,
      canonical_name: "玉ねぎ",
      kana: null,
      aliases: [],
      category: "vegetable",
      default_unit: null,
      is_pantry_staple: false,
      sort_order: 0,
    });
    setServer({});

    await pullLibrary();

    expect(await db.recipes.get(RECIPE_A)).toBeDefined();
    expect(await db.ingredients.get(ONION)).toBeDefined();
  });

  it("reads past the 1000-row page limit before deciding what is missing", async () => {
    // 1 ページで打ち切ると、1001 件目以降が「サーバーに無い」と誤判定されて消える。
    const many = Array.from({ length: 1001 }, (_, i) =>
      recipe(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, `レシピ${i}`),
    );
    await db.recipes.bulkPut(many);
    setServer({ recipes: many });

    const count = await pullLibrary();

    expect(count).toBe(1001);
    expect(await db.recipes.count()).toBe(1001);
  });

  it("keeps a source both sides still have, server の値のまま", async () => {
    await db.sources.put({
      id: SOURCE,
      name: "リュウジ",
      kind: "youtube",
      identifier: "UCxxx",
      icon_url: null,
      is_enabled: false,
      created_at: "2026-09-01T00:00:00.000Z",
    });
    setServer({
      sources: [
        {
          id: SOURCE,
          name: "リュウジ",
          kind: "youtube",
          identifier: "UCxxx",
          icon_url: null,
          is_enabled: false,
          created_at: "2026-09-01T00:00:00.000Z",
        },
      ],
    });

    await pullLibrary();

    expect((await db.sources.get(SOURCE))?.is_enabled).toBe(false);
  });
});
