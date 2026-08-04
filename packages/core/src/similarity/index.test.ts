import { describe, expect, it } from "vitest";
import { checkSimilarity, overlapRatio, trigrams } from "./index.ts";

describe("trigrams", () => {
  it("builds character 3-grams", () => {
    expect(trigrams("あいうえ")).toEqual(new Set(["あいう", "いうえ"]));
  });

  it("returns the whole string for inputs shorter than 3 chars", () => {
    expect(trigrams("ab")).toEqual(new Set(["ab"]));
  });

  it("ignores whitespace and punctuation", () => {
    expect(trigrams("あ、い う")).toEqual(trigrams("あいう"));
  });

  it("returns empty set for empty input", () => {
    expect(trigrams("   ").size).toBe(0);
  });
});

describe("overlapRatio", () => {
  it("is 1 when the summary is fully contained in the original", () => {
    expect(overlapRatio("豚肉を炒める", "豚肉を炒める。仕上げに醤油。")).toBe(1);
  });

  it("is low for unrelated text", () => {
    expect(overlapRatio("肉を焼く", "野菜を茹でる")).toBeLessThan(0.2);
  });

  it("is 0 when either side is empty", () => {
    expect(overlapRatio("", "豚肉を炒める")).toBe(0);
    expect(overlapRatio("豚肉を炒める", "")).toBe(0);
  });

  it("gives a mid-range ratio for partial reuse", () => {
    const r = overlapRatio("豚バラを強火で炒める", "豚バラを弱火でじっくり煮込む");
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
  });
});

describe("checkSimilarity", () => {
  it("flags summaries that exceed the threshold", () => {
    const v = checkSimilarity("豚肉を炒める", "豚肉を炒めて盛り付ける", 0.6);
    expect(v.exceeded).toBe(true);
    expect(v.ratio).toBeGreaterThan(0.6);
  });

  it("passes sufficiently reworded summaries", () => {
    const v = checkSimilarity("肉に火を通す", "豚バラをこんがり焼き上げてください", 0.6);
    expect(v.exceeded).toBe(false);
  });
});
