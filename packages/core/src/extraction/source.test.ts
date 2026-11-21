import { describe, expect, it } from "vitest";
import { deriveSource } from "./source.ts";

describe("deriveSource", () => {
  it("uses the YouTube channel when the hint provides it", () => {
    expect(
      deriveSource("https://www.youtube.com/watch?v=abc123", {
        channelId: "UCryuji",
        channelTitle: "リュウジのバズレシピ",
      }),
    ).toEqual({ kind: "youtube", identifier: "UCryuji", name: "リュウジのバズレシピ" });
  });

  it("falls back to a single YouTube source when the channel is unknown", () => {
    expect(deriveSource("https://youtu.be/abc123")).toEqual({
      kind: "youtube",
      identifier: "youtube.com",
      name: "YouTube",
    });
  });

  it("treats youtube shorts as youtube", () => {
    expect(deriveSource("https://www.youtube.com/shorts/abc123").kind).toBe("youtube");
  });

  it("uses the Instagram account when the URL contains one", () => {
    expect(deriveSource("https://www.instagram.com/ryuji/p/xyz/")).toEqual({
      kind: "instagram",
      identifier: "ryuji",
      name: "@ryuji",
    });
  });

  it("keeps post-only Instagram URLs as a single source", () => {
    expect(deriveSource("https://www.instagram.com/reel/xyz/")).toEqual({
      kind: "instagram",
      identifier: "instagram.com",
      name: "Instagram",
    });
  });

  it("uses the hostname for web recipes and drops www", () => {
    expect(deriveSource("https://www.delishkitchen.tv/recipes/123")).toEqual({
      kind: "web",
      identifier: "delishkitchen.tv",
      name: "delishkitchen.tv",
    });
  });

  it("prefers a site name hint for the display name but keeps the host as identifier", () => {
    expect(deriveSource("https://cookpad.com/recipe/1", { siteName: "クックパッド" })).toEqual({
      kind: "web",
      identifier: "cookpad.com",
      name: "クックパッド",
    });
  });

  it("returns the same identifier for different pages of one site", () => {
    const a = deriveSource("https://delishkitchen.tv/recipes/1");
    const b = deriveSource("https://delishkitchen.tv/recipes/2?utm_source=x");
    expect(a.identifier).toBe(b.identifier);
  });

  it("falls back to an unknown source for unparsable URLs", () => {
    expect(deriveSource("not a url")).toEqual({
      kind: "web",
      identifier: "unknown",
      name: "不明なソース",
    });
  });
});

describe("deriveSource / Instagram のアカウント特定", () => {
  it("uses the account from the embed view when the url has none", () => {
    // /p/<code>/ 形式は発信者を含まない。ヒントが無いと全部 1 ソースに潰れる。
    expect(deriveSource("https://www.instagram.com/p/DcriP0rk9Oi/")).toEqual({
      kind: "instagram",
      identifier: "instagram.com",
      name: "Instagram",
    });
    expect(
      deriveSource("https://www.instagram.com/p/DcriP0rk9Oi/", {
        instagramUser: "5jipapa.recipe",
      }),
    ).toEqual({
      kind: "instagram",
      identifier: "5jipapa.recipe",
      name: "@5jipapa.recipe",
    });
  });

  it("prefers the hint over the url (どちらでも同じアカウントに寄る)", () => {
    expect(
      deriveSource("https://www.instagram.com/5jipapa.recipe/p/DcriP0rk9Oi/", {
        instagramUser: "5jipapa.recipe",
      }).identifier,
    ).toBe("5jipapa.recipe");
  });
});
