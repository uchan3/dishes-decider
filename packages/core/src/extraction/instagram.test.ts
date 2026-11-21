import { describe, expect, it } from "vitest";
import {
  extractInstagramCaption,
  instagramEmbedUrl,
  instagramShortcode,
  isInstagramUrl,
} from "./instagram.ts";

/**
 * 実際の埋め込みビュー（`/p/<code>/embed/captioned/`）のマークアップを写したもの。
 * 構造だけ同じにして短くしてある: アカウント名リンク → `<br />` 区切りの本文。
 */
const EMBED_HTML = `<!DOCTYPE html><html><body>
<div class="EmbedFrame">
  <div class="Caption"><a class="CaptionUsername" href="https://www.instagram.com/5jipapa.recipe/?utm_source=ig_embed" target="_blank">5jipapa.recipe</a><br /><br />＼夏休みのひるごはん50／ DAY 50 🍚<br /><br />【冷やし梅しらす茶漬け】<br /><br />▼材料（1人分）<br />・ごはん200g（冷やごはん可）<br />・梅干し1個<br />・しらす大さじ2<br />・白だし大さじ1＋冷水150ml<br /><br />▼作り方<br />①白だしを冷水で割って冷たいだしを作る。<br />②ごはんに梅・しらす・ごまをのせる。<br /><br /><a href="/explore/tags/recipe/">#レシピ</a> &amp; <a href="/explore/tags/jitan/">#時短</a></div>
  <div class="CaptionComments"><div class="SizeCaptionLikes">28 likes</div>Add a comment...</div>
</body></html>`;

describe("isInstagramUrl", () => {
  it("recognises instagram hosts", () => {
    expect(isInstagramUrl("https://www.instagram.com/p/ABC/")).toBe(true);
    expect(isInstagramUrl("https://instagram.com/p/ABC/")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isInstagramUrl("https://www.youtube.com/watch?v=x")).toBe(false);
    expect(isInstagramUrl("not a url")).toBe(false);
    // ホスト名に instagram を含むだけの別ドメインに釣られない。
    expect(isInstagramUrl("https://instagram.com.evil.example/p/ABC/")).toBe(false);
  });
});

describe("instagramShortcode", () => {
  it("reads the shortcode from every link shape Instagram hands out", () => {
    const cases: [string, string][] = [
      ["https://www.instagram.com/p/DcriP0rk9Oi/", "DcriP0rk9Oi"],
      ["https://www.instagram.com/reel/DEPmxfdyvfk/", "DEPmxfdyvfk"],
      ["https://www.instagram.com/reels/DEPmxfdyvfk/", "DEPmxfdyvfk"],
      ["https://www.instagram.com/tv/ABC123/", "ABC123"],
      // プロフィールから辿るとアカウント名が前に付く。
      ["https://www.instagram.com/5jipapa.recipe/p/DcriP0rk9Oi/", "DcriP0rk9Oi"],
      ["https://www.instagram.com/5jipapa.recipe/reel/DEPmxfdyvfk/", "DEPmxfdyvfk"],
      // 共有リンクに付くパラメータは無視する。
      ["https://www.instagram.com/p/DcriP0rk9Oi/?igsh=MXZ4ZmJ5&utm_source=ig_web", "DcriP0rk9Oi"],
      ["https://www.instagram.com/p/Abc-_123/", "Abc-_123"],
    ];
    for (const [url, expected] of cases) {
      expect(instagramShortcode(url), url).toBe(expected);
    }
  });

  it("returns null when there is no post in the url", () => {
    expect(instagramShortcode("https://www.instagram.com/5jipapa.recipe/")).toBeNull();
    expect(instagramShortcode("https://example.com/p/ABC/")).toBeNull();
  });
});

describe("instagramEmbedUrl", () => {
  it("normalises posts and reels to the captioned embed view", () => {
    expect(instagramEmbedUrl("https://www.instagram.com/reel/DEPmxfdyvfk/?igsh=x")).toBe(
      "https://www.instagram.com/p/DEPmxfdyvfk/embed/captioned/",
    );
    expect(instagramEmbedUrl("https://www.instagram.com/5jipapa/p/ABC_1/")).toBe(
      "https://www.instagram.com/p/ABC_1/embed/captioned/",
    );
  });

  it("returns null for anything that is not a post", () => {
    expect(instagramEmbedUrl("https://www.youtube.com/watch?v=x")).toBeNull();
  });
});

describe("extractInstagramCaption", () => {
  it("pulls the caption out of the embed view", () => {
    const caption = extractInstagramCaption(EMBED_HTML);

    expect(caption).toContain("冷やし梅しらす茶漬け");
    expect(caption).toContain("▼材料（1人分）");
    expect(caption).toContain("・白だし大さじ1＋冷水150ml");
  });

  it("keeps the line breaks (材料の箇条書きが 1 行に潰れると取りこぼす)", () => {
    const caption = extractInstagramCaption(EMBED_HTML) ?? "";
    const lines = caption.split("\n");

    expect(lines).toContain("・ごはん200g（冷やごはん可）");
    expect(lines).toContain("・梅干し1個");
    expect(lines.filter((l) => l.startsWith("・"))).toHaveLength(4);
  });

  it("drops the account name link that precedes the caption", () => {
    const caption = extractInstagramCaption(EMBED_HTML) ?? "";

    expect(caption.startsWith("＼夏休みのひるごはん50／")).toBe(true);
    expect(caption).not.toContain("5jipapa.recipe");
  });

  it("keeps hashtag text but not the markup, and decodes entities", () => {
    const caption = extractInstagramCaption(EMBED_HTML) ?? "";

    expect(caption).toContain("#レシピ & #時短");
    expect(caption).not.toContain("<a");
    expect(caption).not.toContain("&amp;");
  });

  it("stops at the caption and leaves the surrounding chrome out", () => {
    const caption = extractInstagramCaption(EMBED_HTML) ?? "";

    expect(caption).not.toContain("28 likes");
    expect(caption).not.toContain("Add a comment");
  });

  it("collapses runs of blank lines", () => {
    const caption = extractInstagramCaption(EMBED_HTML) ?? "";

    expect(caption).not.toMatch(/\n{3,}/);
  });

  it("returns null when the page has no caption (ブラウザ UA で外殻が返ったとき)", () => {
    expect(extractInstagramCaption("<html><body><div id=\"root\"></div></body></html>")).toBeNull();
    expect(extractInstagramCaption('<div class="Caption"><a class="CaptionUsername">x</a></div>'))
      .toBeNull();
  });
});
