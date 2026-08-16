import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "@recipe-planner/core";
import type { ShoppingItemRow } from "../db/schema.ts";
import { reconcileShoppingItems, shoppingListId } from "./shopping.ts";

const PLAN_ID = "plan-2026-08-17";

/** 連番の ID を返す（テストを決定論にするため）。 */
function idFactory(prefix = "new"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const aggregated = (partial: Partial<ShoppingItem> = {}): ShoppingItem => ({
  ingredientId: "ing-onion",
  displayName: "玉ねぎ",
  quantity: 2,
  unit: "個",
  ambiguousNote: null,
  category: "vegetable",
  sourceRecipeIds: ["r1"],
  ...partial,
});

const saved = (partial: Partial<ShoppingItemRow> = {}): ShoppingItemRow => ({
  id: "row-1",
  shopping_list_id: shoppingListId(PLAN_ID),
  meal_plan_id: PLAN_ID,
  ingredient_id: "ing-onion",
  display_name: "玉ねぎ",
  quantity: 2,
  unit: "個",
  ambiguous_note: null,
  category: "vegetable",
  is_checked: false,
  is_manual: false,
  source_recipe_ids: ["r1"],
  position: 0,
  ...partial,
});

describe("reconcileShoppingItems", () => {
  it("creates rows for a first-time list", () => {
    const { rows, removedIds } = reconcileShoppingItems(
      PLAN_ID,
      [aggregated(), aggregated({ ingredientId: "ing-pork", displayName: "豚肉", category: "meat" })],
      [],
      idFactory(),
    );

    expect(removedIds).toEqual([]);
    expect(rows.map((r) => r.id)).toEqual(["new-1", "new-2"]);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
    expect(rows.every((r) => r.is_checked === false)).toBe(true);
    expect(rows[0]?.shopping_list_id).toBe(shoppingListId(PLAN_ID));
    expect(rows[0]?.meal_plan_id).toBe(PLAN_ID);
  });

  it("keeps the id and checked state of items that survive a regeneration", () => {
    const existing = [saved({ id: "row-onion", is_checked: true })];
    const { rows } = reconcileShoppingItems(
      PLAN_ID,
      [aggregated({ quantity: 3 })],
      existing,
      idFactory(),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("row-onion");
    expect(rows[0]?.is_checked).toBe(true);
    // 数量は新しい集約結果で更新される。
    expect(rows[0]?.quantity).toBe(3);
  });

  it("matches unlinked items by normalized display name", () => {
    const existing = [
      saved({ id: "row-negi", ingredient_id: null, display_name: "ながねぎ", is_checked: true }),
    ];
    const { rows, removedIds } = reconcileShoppingItems(
      PLAN_ID,
      [aggregated({ ingredientId: null, displayName: "ナガネギ" })],
      existing,
      idFactory(),
    );

    expect(removedIds).toEqual([]);
    expect(rows[0]?.id).toBe("row-negi");
    expect(rows[0]?.is_checked).toBe(true);
    // 表示名は新しい集約結果を採用する。
    expect(rows[0]?.display_name).toBe("ナガネギ");
  });

  it("removes items that dropped out of the plan", () => {
    const existing = [
      saved({ id: "row-onion" }),
      saved({ id: "row-pork", ingredient_id: "ing-pork", display_name: "豚肉", category: "meat" }),
    ];
    const { rows, removedIds } = reconcileShoppingItems(
      PLAN_ID,
      [aggregated()],
      existing,
      idFactory(),
    );

    expect(rows.map((r) => r.id)).toEqual(["row-onion"]);
    expect(removedIds).toEqual(["row-pork"]);
  });

  it("keeps manual items and places them after generated ones", () => {
    const existing = [
      saved({
        id: "row-milk",
        ingredient_id: null,
        display_name: "トイレットペーパー",
        category: "other",
        is_manual: true,
        is_checked: true,
        position: 9,
      }),
    ];
    const { rows, removedIds } = reconcileShoppingItems(
      PLAN_ID,
      [aggregated()],
      existing,
      idFactory(),
    );

    expect(removedIds).toEqual([]);
    expect(rows.map((r) => r.id)).toEqual(["new-1", "row-milk"]);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
    expect(rows[1]?.is_checked).toBe(true);
    expect(rows[1]?.is_manual).toBe(true);
  });

  it("does not reuse one saved row for two aggregated items", () => {
    const existing = [saved({ id: "row-onion", is_checked: true })];
    const { rows } = reconcileShoppingItems(
      PLAN_ID,
      [aggregated(), aggregated({ ingredientId: "ing-carrot", displayName: "にんじん" })],
      existing,
      idFactory(),
    );

    expect(rows.map((r) => r.id)).toEqual(["row-onion", "new-1"]);
    expect(rows[1]?.is_checked).toBe(false);
  });
});
