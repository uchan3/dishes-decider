import { describe, expect, it } from "vitest";
import { extractJsonLdBlocks, htmlToText } from "./html.ts";

describe("extractJsonLdBlocks", () => {
  it("extracts ld+json script contents", () => {
    const html = `
      <html><head>
      <script type="application/ld+json">{"@type":"Recipe","name":"a"}</script>
      <script>console.log("ignored")</script>
      <script type='application/ld+json'>{"@type":"Recipe","name":"b"}</script>
      </head></html>`;
    const blocks = extractJsonLdBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(JSON.parse(blocks[0]!).name).toBe("a");
    expect(JSON.parse(blocks[1]!).name).toBe("b");
  });

  it("returns empty array when none present", () => {
    expect(extractJsonLdBlocks("<html><body>hi</body></html>")).toEqual([]);
  });
});

describe("htmlToText", () => {
  it("strips tags, scripts and styles", () => {
    const html =
      "<div>材料<script>bad()</script><style>.x{}</style> <b>玉ねぎ</b> 1個</div>";
    expect(htmlToText(html)).toBe("材料 玉ねぎ 1個");
  });

  it("decodes common entities", () => {
    expect(htmlToText("<p>塩&amp;胡椒&nbsp;少々</p>")).toBe("塩&胡椒 少々");
  });

  it("truncates to maxLength", () => {
    const long = "<p>" + "あ".repeat(100) + "</p>";
    expect(htmlToText(long, 10)).toHaveLength(10);
  });
});
