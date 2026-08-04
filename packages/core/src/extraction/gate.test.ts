import { describe, expect, it, vi } from "vitest";
import { applySimilarityGate } from "./gate.ts";
import type { ExtractedStep } from "./types.ts";

const steps = (summaries: (string | null)[]): ExtractedStep[] =>
  summaries.map((summary, i) => ({ position: i + 1, summary }));

describe("applySimilarityGate", () => {
  it("passes reworded summaries without regenerating", async () => {
    const regenerate = vi.fn();
    const result = await applySimilarityGate(
      steps(["肉に火を通す"]),
      { 1: "豚バラをこんがり焼き上げてください" },
      regenerate,
      { threshold: 0.6 },
    );
    expect(result[0]?.summary).toBe("肉に火を通す");
    expect(regenerate).not.toHaveBeenCalled();
  });

  it("regenerates when the summary is too close, then accepts", async () => {
    const regenerate = vi.fn(async () => "肉を加熱");
    const result = await applySimilarityGate(
      steps(["豚肉を炒める"]),
      { 1: "豚肉を炒めて盛り付ける" },
      regenerate,
      { threshold: 0.6 },
    );
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(result[0]?.summary).toBe("肉を加熱");
  });

  it("drops the summary after max retries still exceed the threshold", async () => {
    // 常に原文そのままを返す再生成 → 何度やっても超過。
    const regenerate = vi.fn(async () => "豚肉を炒めて盛り付ける");
    const result = await applySimilarityGate(
      steps(["豚肉を炒めて盛り付ける"]),
      { 1: "豚肉を炒めて盛り付ける" },
      regenerate,
      { threshold: 0.6, maxRetries: 2 },
    );
    expect(regenerate).toHaveBeenCalledTimes(2);
    expect(result[0]?.summary).toBeNull(); // 破棄 → 原典参照へ
    expect(result[0]?.similarityScore).toBeGreaterThan(0.6);
  });

  it("skips steps with no original text or no summary", async () => {
    const regenerate = vi.fn();
    const result = await applySimilarityGate(
      steps(["要約あり原文なし", null]),
      {}, // 原文なし
      regenerate,
      { threshold: 0.6 },
    );
    expect(result[0]?.summary).toBe("要約あり原文なし");
    expect(result[1]?.summary).toBeNull();
    expect(regenerate).not.toHaveBeenCalled();
  });
});
