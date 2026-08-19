import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase.ts", () => ({ isSupabaseConfigured: true, supabase: {} }));

import { db, type IngredientRow } from "../db/schema.ts";
import {
  findDirtyMasters,
  mergeIngredients,
  mergedAliases,
  suggestMerges,
  tidyIngredientNames,
} from "./ingredientMerge.ts";

const master = (partial: Partial<IngredientRow> = {}): IngredientRow => ({
  id: "ing-1",
  canonical_name: "玉ねぎ",
  kana: null,
  aliases: [],
  category: "vegetable",
  default_unit: null,
  is_pantry_staple: false,
  sort_order: 0,
  ...partial,
});

describe("mergedAliases", () => {
  it("takes over the absorbed name and its aliases", () => {
    const target = master({ id: "a", canonical_name: "玉ねぎ", aliases: ["たまねぎ"] });
    const source = master({ id: "b", canonical_name: "玉葱", aliases: ["オニオン"] });

    expect(mergedAliases(target, source)).toEqual(["たまねぎ", "玉葱", "オニオン"]);
  });

  it("drops names that normalize to the surviving canonical name", () => {
    // 「ニンジン」も「にんじん 」も正規化すると残る側の正規名と同じ＝別名として無意味。
    const target = master({ id: "a", canonical_name: "にんじん", aliases: ["ニンジン"] });
    const source = master({ id: "b", canonical_name: "にんじん", aliases: ["にんじん "] });

    expect(mergedAliases(target, source)).toEqual([]);
  });

  it("keeps distinct spellings only once", () => {
    const target = master({ id: "a", canonical_name: "玉ねぎ", aliases: ["たまねぎ"] });
    const source = master({ id: "b", canonical_name: "タマネギ", aliases: ["玉葱", "玉葱"] });

    // 「タマネギ」は「たまねぎ」と同じキーなので落ち、「玉葱」だけが増える。
    expect(mergedAliases(target, source)).toEqual(["たまねぎ", "玉葱"]);
  });

  it("never keeps the surviving canonical name as its own alias", () => {
    const target = master({ id: "a", canonical_name: "豆腐" });
    const source = master({ id: "b", canonical_name: "とうふ", aliases: ["豆腐"] });

    expect(mergedAliases(target, source)).toEqual(["とうふ"]);
  });
});

describe("suggestMerges", () => {
  const usage = new Map<string, number>();

  it("suggests masters whose names normalize to the same key", () => {
    const a = master({ id: "a", canonical_name: "玉ねぎ" });
    const b = master({ id: "b", canonical_name: "玉ネギ" });

    const result = suggestMerges([a, b], usage);
    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toBe("same_name");
  });

  it("suggests a name that fully contains another in the same aisle", () => {
    const onion = master({ id: "a", canonical_name: "玉ねぎ" });
    const onion2 = master({ id: "b", canonical_name: "玉ねぎ（新玉）" });
    const carrot = master({ id: "c", canonical_name: "にんじん" });

    const result = suggestMerges([onion, onion2, carrot], usage);

    expect(result).toHaveLength(1);
    expect(result[0]?.reason).toBe("contained");
    expect([result[0]?.target.id, result[0]?.source.id].sort()).toEqual(["a", "b"]);
  });

  it("never suggests different ingredients that merely share a suffix", () => {
    // 3-gram 類似度だとこの 2 つは 75% 程度で「似ている」と出てしまう。
    const beef = master({ id: "a", canonical_name: "牛こま切れ肉", category: "meat" });
    const pork = master({ id: "b", canonical_name: "豚こま切れ肉", category: "meat" });

    expect(suggestMerges([beef, pork], usage)).toEqual([]);
  });

  it("does not suggest a containment across different aisles", () => {
    const soySauce = master({ id: "a", canonical_name: "醤油", category: "seasoning" });
    const ramen = master({ id: "b", canonical_name: "醤油ラーメン", category: "dry_goods" });

    expect(suggestMerges([soySauce, ramen], usage)).toEqual([]);
  });

  it("keeps the more general name for a containment, even if the longer one is used more", () => {
    // 「にんにく 1かけ」の方が使用数が多くても、残すのは「にんにく」。
    const short = master({ id: "a", canonical_name: "にんにく" });
    const long = master({ id: "b", canonical_name: "にんにく 1かけ" });

    const result = suggestMerges([short, long], new Map([["b", 5]]));
    expect(result[0]?.target.id).toBe("a");
    expect(result[0]?.source.id).toBe("b");
  });

  it("keeps the more used master when two names are the same", () => {
    const a = master({ id: "a", canonical_name: "玉ねぎ" });
    const b = master({ id: "b", canonical_name: "玉ネギ" });

    const result = suggestMerges([a, b], new Map([["b", 5]]));
    expect(result[0]?.target.id).toBe("b");
  });

  it("does not suggest unrelated ingredients", () => {
    const masters = [
      master({ id: "a", canonical_name: "玉ねぎ" }),
      master({ id: "b", canonical_name: "豚こま切れ肉" }),
      master({ id: "c", canonical_name: "醤油" }),
    ];
    expect(suggestMerges(masters, usage)).toEqual([]);
  });

  it("puts certain duplicates (same name) before containment guesses", () => {
    const masters = [
      master({ id: "a", canonical_name: "玉ねぎ（新玉）" }),
      master({ id: "b", canonical_name: "玉ねぎ" }),
      master({ id: "c", canonical_name: "玉ネギ" }),
    ];
    const result = suggestMerges(masters, usage);
    expect(result[0]?.reason).toBe("same_name");
  });
});

describe("mergeIngredients", () => {
  const TARGET = "aaaaaaaa-0000-4000-8000-000000000001";
  const SOURCE = "bbbbbbbb-0000-4000-8000-000000000002";

  beforeEach(async () => {
    await Promise.all([
      db.ingredients.clear(),
      db.recipeIngredients.clear(),
      db.shoppingItems.clear(),
      db.outbox.clear(),
    ]);
    await db.ingredients.bulkAdd([
      master({ id: TARGET, canonical_name: "玉ねぎ" }),
      master({ id: SOURCE, canonical_name: "玉葱" }),
    ]);
  });

  it("relinks recipe lines and shopping items, then removes the absorbed master", async () => {
    await db.recipeIngredients.add({
      id: "cccccccc-0000-4000-8000-000000000003",
      recipe_id: "dddddddd-0000-4000-8000-000000000004",
      ingredient_id: SOURCE,
      raw_text: "玉葱 1個",
      display_name: "玉葱",
      quantity: 1,
      unit: "個",
      is_ambiguous: false,
      position: 0,
    });
    // shoppingItems の ingredient_id は非インデックス列。ここで拾えることを保証する。
    await db.shoppingItems.add({
      id: "eeeeeeee-0000-4000-8000-000000000005",
      shopping_list_id: "list-plan-2026-08-17",
      meal_plan_id: "plan-2026-08-17",
      ingredient_id: SOURCE,
      display_name: "玉葱",
      quantity: 1,
      unit: "個",
      ambiguous_note: null,
      category: "vegetable",
      is_checked: false,
      is_manual: false,
      source_recipe_ids: [],
      position: 0,
    });

    const result = await mergeIngredients(TARGET, SOURCE);

    expect(result.relinked).toBe(1);
    expect(result.aliases).toEqual(["玉葱"]);
    expect(await db.ingredients.get(SOURCE)).toBeUndefined();
    expect((await db.ingredients.get(TARGET))?.aliases).toEqual(["玉葱"]);
    expect((await db.recipeIngredients.toArray())[0]?.ingredient_id).toBe(TARGET);
    expect((await db.shoppingItems.toArray())[0]?.ingredient_id).toBe(TARGET);
  });

  it("queues the change for Supabase, deleting the absorbed master last", async () => {
    await mergeIngredients(TARGET, SOURCE);

    const queued = await db.outbox.orderBy("seq").toArray();
    expect(queued.map((row) => [row.table_name, row.op])).toEqual([
      ["ingredients", "put"],
      ["ingredients", "delete"],
    ]);
    expect(queued[1]?.record_id).toBe(SOURCE);
  });

  it("does nothing when both sides are the same master", async () => {
    expect(await mergeIngredients(TARGET, TARGET)).toEqual({ relinked: 0, aliases: [] });
    expect(await db.ingredients.count()).toBe(2);
  });

  it("fails clearly when a master is missing", async () => {
    await expect(mergeIngredients(TARGET, "ffffffff-0000-4000-8000-000000000006")).rejects.toThrow(
      /見つかりません/,
    );
  });
});

describe("findDirtyMasters / tidyIngredientNames", () => {
  const CLEAN = "aaaaaaaa-0000-4000-8000-00000000000a";
  const DIRTY = "bbbbbbbb-0000-4000-8000-00000000000b";
  const LONELY = "cccccccc-0000-4000-8000-00000000000c";

  beforeEach(async () => {
    await Promise.all([
      db.ingredients.clear(),
      db.recipeIngredients.clear(),
      db.shoppingItems.clear(),
      db.outbox.clear(),
    ]);
  });

  it("lists only masters whose name carries an amount", () => {
    const rows = [
      master({ id: CLEAN, canonical_name: "にんにく" }),
      master({ id: DIRTY, canonical_name: "にんにく 1かけ" }),
      master({ id: LONELY, canonical_name: "醤油 大さじ2" }),
    ];
    expect(findDirtyMasters(rows).map((d) => [d.master.id, d.cleanName])).toEqual([
      [DIRTY, "にんにく"],
      [LONELY, "醤油"],
    ]);
  });

  it("merges into the clean master when one exists", async () => {
    await db.ingredients.bulkAdd([
      master({ id: CLEAN, canonical_name: "にんにく" }),
      master({ id: DIRTY, canonical_name: "にんにく 1かけ" }),
    ]);

    expect(await tidyIngredientNames()).toEqual({ scanned: 1, renamed: 0, merged: 1 });
    expect(await db.ingredients.get(DIRTY)).toBeUndefined();
    expect((await db.ingredients.get(CLEAN))?.aliases).toEqual(["にんにく 1かけ"]);
  });

  it("just renames when there is no clean master", async () => {
    await db.ingredients.add(master({ id: LONELY, canonical_name: "醤油 大さじ2" }));

    expect(await tidyIngredientNames()).toEqual({ scanned: 1, renamed: 1, merged: 0 });
    expect((await db.ingredients.get(LONELY))?.canonical_name).toBe("醤油");
  });

  it("does nothing when every name is already clean", async () => {
    await db.ingredients.add(master({ id: CLEAN, canonical_name: "にんにく" }));
    expect(await tidyIngredientNames()).toEqual({ scanned: 0, renamed: 0, merged: 0 });
    expect(await db.outbox.count()).toBe(0);
  });
});
