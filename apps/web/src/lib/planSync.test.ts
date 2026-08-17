import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase.ts", () => ({ isSupabaseConfigured: true, supabase: {} }));

import type { MealPlanRow, ShoppingItemRow } from "../db/schema.ts";
import { mergeShoppingItems, shouldApplyPlan } from "./planSync.ts";

const PLAN_ID = "plan-2026-08-17";
const EARLY = "2026-08-17T09:00:00.000Z";
const LATE = "2026-08-17T10:00:00.000Z";

const item = (partial: Partial<ShoppingItemRow> = {}): ShoppingItemRow => ({
  id: "item-1",
  shopping_list_id: `list-${PLAN_ID}`,
  meal_plan_id: PLAN_ID,
  ingredient_id: "ing-onion",
  display_name: "玉ねぎ",
  quantity: 2,
  unit: "個",
  ambiguous_note: null,
  category: "vegetable",
  is_checked: false,
  is_manual: false,
  source_recipe_ids: [],
  position: 0,
  ...partial,
});

const plan = (updatedAt: string): MealPlanRow => ({
  id: PLAN_ID,
  start_date: "2026-08-17",
  status: "draft",
  meals: [],
  created_at: EARLY,
  updated_at: updatedAt,
});

describe("shouldApplyPlan", () => {
  it("accepts a plan we do not have yet", () => {
    expect(shouldApplyPlan(undefined, plan(EARLY))).toBe(true);
  });

  it("accepts a newer plan and rejects an older one", () => {
    expect(shouldApplyPlan(plan(EARLY), plan(LATE))).toBe(true);
    expect(shouldApplyPlan(plan(LATE), plan(EARLY))).toBe(false);
    expect(shouldApplyPlan(plan(LATE), plan(LATE))).toBe(false);
  });
});

describe("mergeShoppingItems", () => {
  it("keeps checks made on both devices (the in-store case)", () => {
    // 手元では玉ねぎ、相手側では豚肉にチェックが付いた。
    const local = [
      item({ id: "a", is_checked: true, updated_at: LATE }),
      item({ id: "b", display_name: "豚肉", is_checked: false, updated_at: EARLY }),
    ];
    const remote = [
      item({ id: "a", is_checked: false, updated_at: EARLY }),
      item({ id: "b", display_name: "豚肉", is_checked: true, updated_at: LATE }),
    ];

    const merged = mergeShoppingItems(local, remote, LATE, LATE);

    expect(merged.map((i) => [i.id, i.is_checked])).toEqual([
      ["a", true],
      ["b", true],
    ]);
  });

  it("takes membership from the newer document", () => {
    // 相手が献立を作り直して品目が入れ替わった（相手のドキュメントが新しい）。
    const local = [item({ id: "a" }), item({ id: "b", display_name: "豚肉" })];
    const remote = [item({ id: "c", display_name: "鶏肉" })];

    expect(mergeShoppingItems(local, remote, EARLY, LATE).map((i) => i.id)).toEqual(["c"]);
    // 逆に手元が新しければ手元の品目が残る。
    expect(mergeShoppingItems(local, remote, LATE, EARLY).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("drops a manual item deleted on the newer side", () => {
    const local = [item({ id: "a" })];
    const remote = [item({ id: "a" }), item({ id: "tp", display_name: "トイレットペーパー" })];
    // 手元で削除した方が新しい → 復活させない。
    expect(mergeShoppingItems(local, remote, LATE, EARLY).map((i) => i.id)).toEqual(["a"]);
  });

  it("falls back to the document time when an item has no timestamp", () => {
    // 旧バージョンで作られた項目（updated_at 無し）でも壊れない。
    const local = [item({ id: "a", is_checked: false })];
    const remote = [item({ id: "a", is_checked: true })];

    expect(mergeShoppingItems(local, remote, EARLY, LATE)[0]?.is_checked).toBe(true);
    expect(mergeShoppingItems(local, remote, LATE, EARLY)[0]?.is_checked).toBe(false);
  });

  it("prefers a per-item timestamp over the document time", () => {
    // ドキュメント全体は相手が新しいが、この項目は手元の方が後にチェックした。
    const local = [item({ id: "a", is_checked: true, updated_at: LATE })];
    const remote = [item({ id: "a", is_checked: false, updated_at: EARLY })];

    expect(mergeShoppingItems(local, remote, EARLY, LATE)[0]?.is_checked).toBe(true);
  });

  it("handles empty lists", () => {
    expect(mergeShoppingItems([], [], EARLY, LATE)).toEqual([]);
    expect(mergeShoppingItems([item()], [], EARLY, LATE)).toEqual([]);
    expect(mergeShoppingItems([], [item()], EARLY, LATE).map((i) => i.id)).toEqual(["item-1"]);
  });
});
