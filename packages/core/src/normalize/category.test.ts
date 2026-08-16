import { describe, expect, it } from "vitest";
import { classifyIngredient } from "./category.ts";

describe("classifyIngredient", () => {
  it("classifies produce, meat, seafood, dairy and dry goods", () => {
    expect(classifyIngredient("玉ねぎ").category).toBe("vegetable");
    expect(classifyIngredient("豚バラ肉").category).toBe("meat");
    expect(classifyIngredient("鮭の切り身").category).toBe("seafood");
    expect(classifyIngredient("牛乳").category).toBe("dairy_egg");
    expect(classifyIngredient("スパゲッティ").category).toBe("dry_goods");
  });

  it("matches katakana and hiragana spellings alike", () => {
    expect(classifyIngredient("タマネギ")).toEqual(classifyIngredient("たまねぎ"));
  });

  it("marks seasonings as pantry staples", () => {
    expect(classifyIngredient("醤油")).toEqual({ category: "seasoning", isPantryStaple: true });
    expect(classifyIngredient("ごま油")).toEqual({ category: "seasoning", isPantryStaple: true });
    expect(classifyIngredient("片栗粉")).toEqual({ category: "dry_goods", isPantryStaple: true });
    expect(classifyIngredient("玉ねぎ").isPantryStaple).toBe(false);
  });

  it("prefers the longest keyword when several match", () => {
    // 「ごま油」は「ごま」(乾物) より長い調味料の語が勝つ。
    expect(classifyIngredient("ごま油").category).toBe("seasoning");
    // 「油揚げ」は「油」(調味料) に勝つ。
    expect(classifyIngredient("油揚げ").category).toBe("dry_goods");
    // 「牛乳」は「牛」(肉) に勝つ。
    expect(classifyIngredient("牛乳").category).toBe("dairy_egg");
    // 「すいか」は「いか」(魚介) に勝つ。
    expect(classifyIngredient("すいか").category).toBe("vegetable");
    // 「にんにく」は「肉」ではなく野菜。
    expect(classifyIngredient("にんにく").category).toBe("vegetable");
    // 「貝割れ大根」は「貝」ではなく野菜。
    expect(classifyIngredient("貝割れ大根").category).toBe("vegetable");
  });

  it("routes 冷凍 items to the frozen aisle regardless of content", () => {
    expect(classifyIngredient("冷凍うどん").category).toBe("frozen");
    expect(classifyIngredient("冷凍ほうれん草").category).toBe("frozen");
    // 名前の途中の「冷凍」は対象外（先頭のみ）。
    expect(classifyIngredient("うどん（冷凍）").category).toBe("dry_goods");
  });

  it("falls back to other for unknown names", () => {
    expect(classifyIngredient("なぞの食材")).toEqual({
      category: "other",
      isPantryStaple: false,
    });
    expect(classifyIngredient("   ")).toEqual({ category: "other", isPantryStaple: false });
  });
});
