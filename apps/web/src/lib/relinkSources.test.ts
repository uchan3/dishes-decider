import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase.ts", () => ({ isSupabaseConfigured: true, supabase: {} }));

import { db, type RecipeRow } from "../db/schema.ts";
import { relinkSources, renameSource } from "./relinkSources.ts";

const recipe = (partial: Partial<RecipeRow> & { id: string }): RecipeRow => ({
  source_id: null,
  title: "レシピ",
  source_url: null,
  thumbnail_url: null,
  dish_roles: ["main"],
  cook_time_min: null,
  servings: 2,
  main_ingredient_category: null,
  cooking_method: null,
  tags: [],
  is_favorite: false,
  is_excluded: false,
  cook_count: 0,
  last_cooked_at: null,
  reject_count: 0,
  created_at: "2026-08-18T00:00:00.000Z",
  updated_at: "2026-08-18T00:00:00.000Z",
  ...partial,
});

const ID = (n: number) => `${n}${"0".repeat(7)}-0000-4000-8000-000000000000`;

describe("relinkSources", () => {
  beforeEach(async () => {
    await Promise.all([db.recipes.clear(), db.sources.clear(), db.outbox.clear()]);
  });

  it("groups recipes from the same site into one source", async () => {
    await db.recipes.bulkAdd([
      recipe({ id: ID(1), source_url: "https://delishkitchen.tv/recipes/1" }),
      recipe({ id: ID(2), source_url: "https://delishkitchen.tv/recipes/2" }),
    ]);

    const result = await relinkSources("user-1");

    expect(result).toMatchObject({ scanned: 2, linked: 2, created: 1 });
    const sources = await db.sources.toArray();
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: "web", identifier: "delishkitchen.tv" });
    const linked = await db.recipes.toArray();
    expect(new Set(linked.map((r) => r.source_id))).toEqual(new Set([sources[0]?.id]));
  });

  it("puts YouTube recipes under a single YouTube source", async () => {
    await db.recipes.bulkAdd([
      recipe({ id: ID(1), source_url: "https://www.youtube.com/watch?v=aaa" }),
      recipe({ id: ID(2), source_url: "https://youtu.be/bbb" }),
    ]);

    await relinkSources("user-1");

    const sources = await db.sources.toArray();
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: "youtube", name: "YouTube" });
  });

  it("reuses a source that already exists", async () => {
    await db.sources.add({
      id: ID(9),
      name: "リュウジのバズレシピ",
      kind: "youtube",
      identifier: "youtube.com",
      icon_url: null,
      is_enabled: true,
      created_at: "2026-08-18T00:00:00.000Z",
    });
    await db.recipes.add(recipe({ id: ID(1), source_url: "https://youtu.be/ccc" }));

    const result = await relinkSources("user-1");

    expect(result.created).toBe(0);
    expect((await db.recipes.get(ID(1)))?.source_id).toBe(ID(9));
  });

  it("leaves recipes that already have a source or lack a url", async () => {
    await db.recipes.bulkAdd([
      recipe({ id: ID(1), source_id: ID(9), source_url: "https://example.com/1" }),
      recipe({ id: ID(2), source_url: null }), // 手動登録
    ]);

    expect(await relinkSources("user-1")).toMatchObject({ scanned: 0, linked: 0 });
    expect(await db.sources.count()).toBe(0);
  });

  it("queues sources before recipes so the foreign key resolves", async () => {
    await db.recipes.add(recipe({ id: ID(1), source_url: "https://delishkitchen.tv/recipes/1" }));

    await relinkSources("user-1");

    const queued = await db.outbox.orderBy("seq").toArray();
    expect(queued.map((row) => row.table_name)).toEqual(["sources", "recipes"]);
  });
});

describe("renameSource", () => {
  beforeEach(async () => {
    await Promise.all([db.sources.clear(), db.outbox.clear()]);
    await db.sources.add({
      id: ID(9),
      name: "YouTube",
      kind: "youtube",
      identifier: "youtube.com",
      icon_url: null,
      is_enabled: true,
      created_at: "2026-08-18T00:00:00.000Z",
    });
  });

  it("renames and queues the change", async () => {
    await renameSource(ID(9), "  リュウジのバズレシピ  ");
    expect((await db.sources.get(ID(9)))?.name).toBe("リュウジのバズレシピ");
    expect(await db.outbox.count()).toBe(1);
  });

  it("ignores an empty name", async () => {
    await renameSource(ID(9), "   ");
    expect((await db.sources.get(ID(9)))?.name).toBe("YouTube");
    expect(await db.outbox.count()).toBe(0);
  });
});
