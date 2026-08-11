import { describe, expect, it } from "vitest";
import {
  extractYouTubeContent,
  extractYouTubeDescription,
  extractYouTubeTitle,
  isYouTubeUrl,
} from "./youtube.ts";

describe("isYouTubeUrl", () => {
  it("recognizes YouTube hosts", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(isYouTubeUrl("https://youtu.be/abc")).toBe(true);
    expect(isYouTubeUrl("https://m.youtube.com/watch?v=abc")).toBe(true);
  });

  it("rejects non-YouTube and invalid URLs", () => {
    expect(isYouTubeUrl("https://example.com/recipe")).toBe(false);
    expect(isYouTubeUrl("not a url")).toBe(false);
  });
});

// shortDescription は JSON エスケープされた文字列（改行は \n、日本語はそのまま）。
const sampleHtml = `
<html><head><title>絶品！豚の生姜焼き【リュウジのバズレシピ】 - YouTube</title></head>
<body>
<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abc","title":"絶品！豚の生姜焼き","shortDescription":"【材料】\\n豚ロース 200g\\n玉ねぎ 1/2個\\n醤油 大さじ2\\n\\n【作り方】\\n1. 玉ねぎを切る\\n2. 炒める"}};</script>
</body></html>`;

describe("extractYouTubeDescription", () => {
  it("extracts and JSON-unescapes the description", () => {
    const desc = extractYouTubeDescription(sampleHtml);
    expect(desc).toContain("豚ロース 200g");
    expect(desc).toContain("玉ねぎ 1/2個");
    // \\n が実改行に復号される。
    expect(desc).toContain("\n");
  });

  it("returns null when absent", () => {
    expect(extractYouTubeDescription("<html><body>no player</body></html>")).toBeNull();
  });
});

describe("extractYouTubeTitle", () => {
  it("prefers videoDetails.title over the <title> tag", () => {
    expect(extractYouTubeTitle(sampleHtml)).toBe("絶品！豚の生姜焼き");
  });

  it("falls back to <title> minus ' - YouTube'", () => {
    const html = "<html><head><title>肉じゃが - YouTube</title></head></html>";
    expect(extractYouTubeTitle(html)).toBe("肉じゃが");
  });
});

describe("extractYouTubeContent", () => {
  it("returns both title and description", () => {
    const { title, description } = extractYouTubeContent(sampleHtml);
    expect(title).toBe("絶品！豚の生姜焼き");
    expect(description).toContain("醤油 大さじ2");
  });
});
