import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase.ts", () => ({ isSupabaseConfigured: true, supabase: {} }));

import { db, type IngredientRow } from "../db/schema.ts";
import {
  addToPantry,
  listPantry,
  pantryIngredientIdSet,
  pantryUsedByRecipe,
  removeFromPantry,
  syncPantryWithCheck,
} from "./pantry.ts";

const ONION = "11111111-1111-4111-8111-111111111111";
const PORK = "22222222-2222-4222-8222-222222222222";

const master = (id: string, name: string, category: IngredientRow["category"]): IngredientRow => ({
  id,
  canonical_name: name,
  kana: null,
  aliases: [],
  category,
  default_unit: null,
  is_pantry_staple: false,
  sort_order: 0,
});

describe("pantry", () => {
  beforeEach(async () => {
    await Promise.all([db.pantryItems.clear(), db.ingredients.clear(), db.outbox.clear()]);
    await db.ingredients.bulkAdd([
      master(ONION, "玉ねぎ", "vegetable"),
      master(PORK, "豚こま切れ肉", "meat"),
    ]);
  });

  it("adds an item and queues it for sync", async () => {
    await addToPantry(ONION);

    expect(await db.pantryItems.get(ONION)).toBeDefined();
    const queued = await db.outbox.toArray();
    expect(queued.map((row) => [row.table_name, row.record_id, row.op])).toEqual([
      ["pantryItems", ONION, "put"],
    ]);
  });

  it("keeps the original added_at when the same item is added twice", async () => {
    await addToPantry(ONION);
    const first = (await db.pantryItems.get(ONION))?.added_at;
    await db.outbox.clear();

    await addToPantry(ONION);

    expect((await db.pantryItems.get(ONION))?.added_at).toBe(first);
    // 二重に送らない。
    expect(await db.outbox.count()).toBe(0);
  });

  it("removes an item and queues the delete", async () => {
    await addToPantry(ONION);
    await db.outbox.clear();

    await removeFromPantry(ONION);

    expect(await db.pantryItems.get(ONION)).toBeUndefined();
    expect((await db.outbox.toArray())[0]).toMatchObject({ record_id: ONION, op: "delete" });
  });

  it("does nothing when removing something that is not there", async () => {
    await removeFromPantry(ONION);
    expect(await db.outbox.count()).toBe(0);
  });

  it("follows the shopping check symmetrically", async () => {
    await syncPantryWithCheck(ONION, true);
    expect(await db.pantryItems.get(ONION)).toBeDefined();

    await syncPantryWithCheck(ONION, false);
    expect(await db.pantryItems.get(ONION)).toBeUndefined();
  });

  it("ignores shopping items that are not linked to a master", async () => {
    // トイレットペーパーのような手動追加項目は冷蔵庫に入れない。
    await syncPantryWithCheck(null, true);
    expect(await db.pantryItems.count()).toBe(0);
  });

  it("exposes the ids as a set for the shopping list", async () => {
    await addToPantry(ONION);
    await addToPantry(PORK);
    expect(await pantryIngredientIdSet()).toEqual(new Set([ONION, PORK]));
  });

  it("lists entries with their master name, sorted by aisle then name", async () => {
    await addToPantry(PORK);
    await addToPantry(ONION);

    const entries = await listPantry();
    expect(entries.map((e) => e.name)).toEqual(["豚こま切れ肉", "玉ねぎ"]);
  });

  it("keeps an entry whose master disappeared, at the end of the list", async () => {
    await addToPantry(ONION);
    await db.ingredients.delete(ONION);

    const entries = await listPantry();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBeNull();
  });
});

describe("pantryUsedByRecipe", () => {
  const RECIPE = "33333333-3333-4333-8333-333333333333";

  const line = (id: string, ingredientId: string | null, name: string) => ({
    id,
    recipe_id: RECIPE,
    ingredient_id: ingredientId,
    raw_text: name,
    display_name: name,
    quantity: 1,
    unit: null,
    is_ambiguous: false,
    position: 0,
  });

  // このブロックは外側の describe の外にあるので、前提を自前で作り直す。
  beforeEach(async () => {
    await Promise.all([
      db.recipeIngredients.clear(),
      db.pantryItems.clear(),
      db.ingredients.clear(),
      db.outbox.clear(),
    ]);
    await db.ingredients.bulkAdd([
      master(ONION, "玉ねぎ", "vegetable"),
      master(PORK, "豚こま切れ肉", "meat"),
    ]);
  });

  it("returns only the ingredients that are actually in the fridge", async () => {
    await addToPantry(ONION);
    await db.recipeIngredients.bulkAdd([
      line("l1", ONION, "玉ねぎ"),
      line("l2", PORK, "豚こま切れ肉"),
      line("l3", null, "水"),
    ]);

    const used = await pantryUsedByRecipe(RECIPE);
    expect(used).toEqual([{ ingredientId: ONION, name: "玉ねぎ" }]);
  });

  it("lists an ingredient once even if the recipe uses it twice", async () => {
    await addToPantry(ONION);
    await db.recipeIngredients.bulkAdd([line("l1", ONION, "玉ねぎ"), line("l2", ONION, "玉ねぎ")]);

    expect(await pantryUsedByRecipe(RECIPE)).toHaveLength(1);
  });

  it("skips pantry staples so seasonings are not asked about every time", async () => {
    await db.ingredients.update(PORK, { is_pantry_staple: true });
    await addToPantry(ONION);
    await addToPantry(PORK);
    await db.recipeIngredients.bulkAdd([line("l1", ONION, "玉ねぎ"), line("l2", PORK, "醤油")]);

    expect(await pantryUsedByRecipe(RECIPE)).toEqual([{ ingredientId: ONION, name: "玉ねぎ" }]);
  });

  it("returns nothing when the fridge is empty", async () => {
    await db.recipeIngredients.add(line("l1", ONION, "玉ねぎ"));
    expect(await pantryUsedByRecipe(RECIPE)).toEqual([]);
  });
});

describe("listPantry の古い判定", () => {
  beforeEach(async () => {
    await Promise.all([db.pantryItems.clear(), db.ingredients.clear()]);
    await db.ingredients.bulkAdd([
      master(ONION, "玉ねぎ", "vegetable"),
      master(PORK, "豚こま切れ肉", "meat"),
    ]);
  });

  it("flags an item that has been in the fridge for a while", async () => {
    await db.pantryItems.put({ id: ONION, added_at: "2020-01-01T00:00:00.000Z" });
    await db.pantryItems.put({ id: PORK, added_at: new Date().toISOString() });

    const entries = await listPantry();
    const byName = new Map(entries.map((e) => [e.name, e.isStale] as const));
    expect(byName.get("玉ねぎ")).toBe(true);
    expect(byName.get("豚こま切れ肉")).toBe(false);
  });
});
