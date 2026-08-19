import { describe, expect, it } from "vitest";
import { stripAmountFromIngredientName as strip } from "./amount.ts";

describe("stripAmountFromIngredientName", () => {
  it("removes a trailing count and unit", () => {
    expect(strip("にんにく 1かけ")).toBe("にんにく");
    expect(strip("玉ねぎ 2個")).toBe("玉ねぎ");
    expect(strip("豚こま切れ肉 300g")).toBe("豚こま切れ肉");
    expect(strip("牛乳200ml")).toBe("牛乳");
    expect(strip("鶏もも肉 1枚")).toBe("鶏もも肉");
  });

  it("removes spoon and cup style amounts written before the number", () => {
    expect(strip("醤油 大さじ2")).toBe("醤油");
    expect(strip("みりん小さじ1/2")).toBe("みりん");
    expect(strip("水 カップ1")).toBe("水");
  });

  it("removes amounts in parentheses", () => {
    expect(strip("にんにく（1かけ）")).toBe("にんにく");
    expect(strip("玉ねぎ(1/2個)")).toBe("玉ねぎ");
    expect(strip("塩（少々）")).toBe("塩");
  });

  it("removes vague amounts", () => {
    expect(strip("塩 少々")).toBe("塩");
    expect(strip("こしょう適量")).toBe("こしょう");
    expect(strip("大葉 お好みで")).toBe("大葉");
  });

  it("handles ranges, fractions and full-width digits", () => {
    expect(strip("水 1〜2カップ")).toBe("水");
    expect(strip("卵 １個")).toBe("卵");
    expect(strip("砂糖 ½カップ")).toBe("砂糖");
  });

  it("removes a bare trailing number", () => {
    expect(strip("卵 2")).toBe("卵");
  });

  it("keeps numbers that belong to the name", () => {
    expect(strip("3色ピーマン")).toBe("3色ピーマン");
    expect(strip("7種のスパイス")).toBe("7種のスパイス");
  });

  it("leaves plain names untouched", () => {
    expect(strip("玉ねぎ")).toBe("玉ねぎ");
    expect(strip("オリーブオイル")).toBe("オリーブオイル");
    expect(strip("  豆腐  ")).toBe("豆腐");
  });

  it("keeps the original when the name is only an amount", () => {
    expect(strip("適量")).toBe("適量");
    expect(strip("大さじ2")).toBe("大さじ2");
  });
});
