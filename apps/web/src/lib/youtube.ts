/**
 * YouTube URL から動画 ID を取り出すヘルパー。
 *
 * 手順表示の「埋め込み優先」（仕様書 §3.6・§3.7）のうち、実質使えるのは YouTube のみ。
 * 原典 URL が YouTube なら iframe 埋め込みに使う。
 */

/**
 * YouTube の各種 URL 形式から動画 ID を抽出する。該当しなければ null。
 *
 * 対応: `watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`。
 *
 * @example
 * ```ts
 * youtubeVideoId("https://youtu.be/abc123DEF45"); // "abc123DEF45"
 * youtubeVideoId("https://example.com/recipe");    // null
 * ```
 */
export function youtubeVideoId(url: string | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    return id || null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
    const m = parsed.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/);
    if (m) return m[1] ?? null;
  }
  return null;
}
