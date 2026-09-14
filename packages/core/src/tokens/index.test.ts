import { describe, expect, it } from "vitest";
import { generateIngestToken, hashIngestToken, looksLikeJwt } from "./index.ts";

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

describe("looksLikeJwt", () => {
  it("recognises a JWT shape", () => {
    expect(looksLikeJwt("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2ln")).toBe(true);
  });

  it("never mistakes an ingest token for a JWT", () => {
    for (let i = 0; i < 20; i++) {
      expect(looksLikeJwt(generateIngestToken())).toBe(false);
    }
  });

  it("rejects the wrong number of segments", () => {
    expect(looksLikeJwt("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0")).toBe(false);
    expect(looksLikeJwt("eyJhbGciOiJIUzI1NiJ9.a.b.c")).toBe(false);
  });

  it("rejects empty segments and non-base64url characters", () => {
    expect(looksLikeJwt("eyJhbGciOiJIUzI1NiJ9..c2ln")).toBe(false);
    expect(looksLikeJwt("eyJhbGciOiJIUzI1NiJ9.pay load.c2ln")).toBe(false);
  });

  it("rejects a three-part string that is not a JWT header", () => {
    expect(looksLikeJwt("aaa.bbb.ccc")).toBe(false);
  });
});
