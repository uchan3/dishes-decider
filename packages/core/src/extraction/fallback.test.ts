import { describe, expect, it, vi } from "vitest";
import {
  createFallbackProvider,
  isRetryableExtractionError,
  ProviderHttpError,
  retryDelayMs,
} from "./fallback.ts";
import type { ExtractionProvider, ProviderExtraction } from "./types.ts";

const RESULT: ProviderExtraction = {
  result: {
    title: "肉じゃが",
    ingredients: [],
    steps: [],
    cookTimeMin: null,
    servings: null,
    dishRoles: [],
    mainIngredientCategory: null,
    cookingMethod: null,
    tags: [],
  },
  originalStepTexts: {},
};

/** 指定回数だけ失敗してから成功するプロバイダ。 */
function flaky(
  name: ExtractionProvider["name"],
  failures: number,
  error: () => Error = () => new ProviderHttpError(429, "quota"),
): ExtractionProvider & { calls: number } {
  let calls = 0;
  return {
    name,
    get calls() {
      return calls;
    },
    extract() {
      calls += 1;
      if (calls <= failures) return Promise.reject(error());
      return Promise.resolve(RESULT);
    },
  } as ExtractionProvider & { calls: number };
}

/** 待たずに進めるテスト用の設定。 */
const noWait = { sleep: () => Promise.resolve(), baseDelayMs: 0 };

describe("isRetryableExtractionError", () => {
  it("retries rate limits and server errors", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(isRetryableExtractionError(new ProviderHttpError(status, "x"))).toBe(true);
    }
  });

  it("does not retry errors that will never change (キーが違う・要求が不正)", () => {
    for (const status of [400, 401, 403, 404]) {
      expect(isRetryableExtractionError(new ProviderHttpError(status, "x"))).toBe(false);
    }
  });

  it("retries non-HTTP failures (ネットワーク断・空応答・JSON 崩れ)", () => {
    expect(isRetryableExtractionError(new Error("Gemini から空の応答"))).toBe(true);
  });
});

describe("retryDelayMs", () => {
  it("doubles each time", () => {
    expect([1, 2, 3].map((a) => retryDelayMs(a, 1000))).toEqual([1000, 2000, 4000]);
  });
});

describe("createFallbackProvider", () => {
  it("rejects an empty provider list (設定ミスは起動時に気付きたい)", () => {
    expect(() => createFallbackProvider([])).toThrow();
  });

  it("returns the first success without touching the fallback", async () => {
    const primary = flaky("gemini", 0);
    const backup = flaky("claude", 0);

    await createFallbackProvider([primary, backup], noWait).extract({ url: "u", text: "t" });

    expect(primary.calls).toBe(1);
    expect(backup.calls).toBe(0);
  });

  it("retries the same provider on a rate limit", async () => {
    const primary = flaky("gemini", 2);
    const backup = flaky("claude", 0);

    await createFallbackProvider([primary, backup], noWait).extract({ url: "u", text: "t" });

    expect(primary.calls).toBe(3);
    expect(backup.calls).toBe(0);
  });

  it("falls back once the retries are used up", async () => {
    const primary = flaky("gemini", 99);
    const backup = flaky("claude", 0);

    const result = await createFallbackProvider([primary, backup], noWait).extract({
      url: "u",
      text: "t",
    });

    expect(primary.calls).toBe(3); // 1 回 + 再試行 2 回
    expect(backup.calls).toBe(1);
    expect(result).toEqual(RESULT);
  });

  it("moves on immediately when retrying cannot help (401 を 3 回投げない)", async () => {
    const primary = flaky("gemini", 99, () => new ProviderHttpError(401, "bad key"));
    const backup = flaky("claude", 0);

    await createFallbackProvider([primary, backup], noWait).extract({ url: "u", text: "t" });

    expect(primary.calls).toBe(1);
    expect(backup.calls).toBe(1);
  });

  it("throws the last error when every provider fails", async () => {
    const primary = flaky("gemini", 99, () => new ProviderHttpError(429, "quota"));
    const backup = flaky("claude", 99, () => new Error("claude も駄目"));

    await expect(
      createFallbackProvider([primary, backup], noWait).extract({ url: "u", text: "t" }),
    ).rejects.toThrow("claude も駄目");
  });

  it("waits with exponential backoff between retries", async () => {
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    const primary = flaky("gemini", 99);

    await expect(
      createFallbackProvider([primary], { sleep, baseDelayMs: 1000 }).extract({
        url: "u",
        text: "t",
      }),
    ).rejects.toThrow();

    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("reports which provider actually did the work", async () => {
    const onSuccess = vi.fn();
    const onAttemptFailed = vi.fn();
    const primary = flaky("gemini", 99);
    const backup = flaky("claude", 0);

    await createFallbackProvider([primary, backup], {
      ...noWait,
      onSuccess,
      onAttemptFailed,
    }).extract({ url: "u", text: "t" });

    expect(onSuccess).toHaveBeenCalledWith({ provider: "claude", attempt: 1 });
    expect(onAttemptFailed).toHaveBeenCalledTimes(3);
    expect(onAttemptFailed.mock.calls.at(-1)?.[0]).toMatchObject({
      provider: "gemini",
      attempt: 3,
      willRetry: false,
      willFallBack: true,
    });
  });
});
