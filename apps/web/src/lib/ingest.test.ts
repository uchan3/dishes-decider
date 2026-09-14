import { describe, expect, it } from "vitest";
import { normalizeIngestUrl } from "./ingest.ts";

/** 成功時の href を取り出す（失敗なら理由を見せて落とす）。 */
function href(input: string): string {
  const result = normalizeIngestUrl(input);
  if (!result.ok) throw new Error(`expected ok but got: ${result.reason}`);
  return result.href;
}

describe("normalizeIngestUrl", () => {
  it("accepts a plain url", () => {
    expect(href("https://example.com/recipe/1")).toBe("https://example.com/recipe/1");
  });

  it("trims surrounding whitespace and newlines", () => {
    expect(href("  https://example.com/recipe/1\n")).toBe("https://example.com/recipe/1");
  });

  it("picks the url out of shared text (共有シートは題名も一緒に渡してくる)", () => {
    expect(href("鶏の唐揚げ\nhttps://youtu.be/abc123")).toBe("https://youtu.be/abc123");
  });

  it("keeps query strings (YouTube の ?v= を落とすと別物になる)", () => {
    expect(href("https://www.youtube.com/watch?v=abc123&t=10s")).toBe(
      "https://www.youtube.com/watch?v=abc123&t=10s",
    );
  });

  it("drops punctuation that trails a pasted url", () => {
    expect(href("これ作りたい（https://example.com/r/1）")).toBe("https://example.com/r/1");
    expect(href("https://example.com/r/1。")).toBe("https://example.com/r/1");
  });

  it("adds https to a bare host", () => {
    expect(href("example.com/recipe/1")).toBe("https://example.com/recipe/1");
  });

  it("rejects an empty input", () => {
    const result = normalizeIngestUrl("   ");
    expect(result).toEqual({ ok: false, reason: "URL を入力してください" });
  });

  it("rejects text with no url in it", () => {
    const result = normalizeIngestUrl("肉じゃがのレシピ");
    expect(result.ok).toBe(false);
  });

  it("rejects internal addresses before they reach the server (SSRF は送信前に弾く)", () => {
    expect(normalizeIngestUrl("http://localhost:8080/x").ok).toBe(false);
    expect(normalizeIngestUrl("http://192.168.1.5/x").ok).toBe(false);
    expect(normalizeIngestUrl("https://169.254.169.254/latest/meta-data").ok).toBe(false);
  });

  it("rejects non-http schemes", () => {
    expect(normalizeIngestUrl("ftp://example.com/x").ok).toBe(false);
    expect(normalizeIngestUrl("javascript:alert(1)").ok).toBe(false);
  });
});
