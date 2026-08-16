import { describe, expect, it } from "vitest";
import { normalizeIngredientName } from "./index.ts";

describe("normalizeIngredientName", () => {
  it("converts katakana to hiragana", () => {
    expect(normalizeIngredientName("タマネギ")).toBe("たまねぎ");
  });

  it("removes half-width and full-width whitespace", () => {
    expect(normalizeIngredientName("玉ねぎ　")).toBe("玉ねぎ");
    expect(normalizeIngredientName(" 長 ねぎ ")).toBe("長ねぎ");
  });

  it("applies NFKC and lowercases latin", () => {
    expect(normalizeIngredientName("Ｔｏｆｕ")).toBe("tofu");
  });

  it("unifies katakana and hiragana spellings to the same key", () => {
    expect(normalizeIngredientName("にんじん")).toBe(normalizeIngredientName("ニンジン"));
  });
});
