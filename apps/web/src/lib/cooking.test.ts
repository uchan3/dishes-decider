import { describe, expect, it } from "vitest";
import type { MealPlanRow, PlanSlotRow } from "../db/schema.ts";
import { deriveLastCookedAt, isSlotCooked } from "./cooking.ts";

const slot = (partial: Partial<PlanSlotRow> = {}): PlanSlotRow => ({
  id: "2026-08-17#main#0",
  dish_role: "main",
  recipe_id: "r1",
  is_locked: false,
  position: 0,
  cooked_at: null,
  ...partial,
});

const plan = (startDate: string, slots: PlanSlotRow[][]): MealPlanRow => ({
  id: `plan-${startDate}`,
  start_date: startDate,
  status: "draft",
  meals: slots.map((daySlots, i) => ({
    id: `meal-${i}`,
    date: startDate,
    meal_type: "dinner",
    template_id: "standard",
    is_skipped: false,
    slots: daySlots,
  })),
  created_at: "",
  updated_at: "",
});

describe("isSlotCooked", () => {
  it("treats a missing field as not cooked (rows saved before the column existed)", () => {
    expect(isSlotCooked(undefined)).toBe(false);
    expect(isSlotCooked(null)).toBe(false);
    expect(isSlotCooked("2026-08-17")).toBe(true);
  });
});

describe("deriveLastCookedAt", () => {
  it("returns null when the recipe was never cooked", () => {
    const plans = [plan("2026-08-17", [[slot()]])];
    expect(deriveLastCookedAt(plans, "r1")).toBeNull();
  });

  it("returns the latest cooked date across plans", () => {
    const plans = [
      plan("2026-08-10", [[slot({ id: "a", cooked_at: "2026-08-11" })]]),
      plan("2026-08-17", [[slot({ id: "b", cooked_at: "2026-08-19" })]]),
      plan("2026-08-24", [[slot({ id: "c", cooked_at: "2026-08-18" })]]),
    ];
    expect(deriveLastCookedAt(plans, "r1")).toBe("2026-08-19");
  });

  it("ignores slots holding a different recipe", () => {
    const plans = [
      plan("2026-08-17", [
        [
          slot({ id: "a", recipe_id: "r2", cooked_at: "2026-08-20" }),
          slot({ id: "b", recipe_id: "r1", cooked_at: "2026-08-18" }),
        ],
      ]),
    ];
    expect(deriveLastCookedAt(plans, "r1")).toBe("2026-08-18");
  });

  it("ignores empty and uncooked slots", () => {
    const plans = [
      plan("2026-08-17", [
        [slot({ id: "a", recipe_id: null, cooked_at: "2026-08-20" }), slot({ id: "b" })],
      ]),
    ];
    expect(deriveLastCookedAt(plans, "r1")).toBeNull();
  });
});
