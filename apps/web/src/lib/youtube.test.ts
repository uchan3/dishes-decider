import { describe, expect, it } from "vitest";
import { youtubeVideoId } from "./youtube.ts";

describe("youtubeVideoId", () => {
  it("extracts id from watch URLs", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=abc123DEF45")).toBe("abc123DEF45");
  });

  it("extracts id from youtu.be short links", () => {
    expect(youtubeVideoId("https://youtu.be/abc123DEF45")).toBe("abc123DEF45");
  });

  it("extracts id from embed and shorts paths", () => {
    expect(youtubeVideoId("https://www.youtube.com/embed/abc123DEF45")).toBe("abc123DEF45");
    expect(youtubeVideoId("https://youtube.com/shorts/abc123DEF45")).toBe("abc123DEF45");
  });

  it("returns null for non-YouTube or invalid URLs", () => {
    expect(youtubeVideoId("https://example.com/recipe")).toBeNull();
    expect(youtubeVideoId("not a url")).toBeNull();
    expect(youtubeVideoId(null)).toBeNull();
  });
});
