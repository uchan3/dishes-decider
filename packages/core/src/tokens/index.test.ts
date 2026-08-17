import { describe, expect, it } from "vitest";
import { generateIngestToken, hashIngestToken } from "./index.ts";

describe("generateIngestToken", () => {
  it("returns a url-safe string with no padding", () => {
    const token = generateIngestToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces a different token every time", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateIngestToken()));
    expect(tokens.size).toBe(50);
  });

  it("encodes the requested number of random bytes", () => {
    // base64url は 3 バイト → 4 文字。32 バイトはパディング無しで 43 文字。
    expect(generateIngestToken(32)).toHaveLength(43);
    expect(generateIngestToken(15)).toHaveLength(20);
  });
});

describe("hashIngestToken", () => {
  it("matches the well-known SHA-256 vector (Edge 側と同じ値になること)", async () => {
    expect(await hashIngestToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("returns 64 hex chars and is stable for the same input", async () => {
    const token = generateIngestToken();
    const first = await hashIngestToken(token);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashIngestToken(token)).toBe(first);
  });

  it("differs for different tokens", async () => {
    expect(await hashIngestToken("a")).not.toBe(await hashIngestToken("b"));
  });
});
