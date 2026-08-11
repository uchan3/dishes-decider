/**
 * YouTube watch ページ HTML からの概要欄・タイトル抽出（仕様書 F-01-1）。
 *
 * 概要欄（材料が書かれることが多い）は `<script>` 内の `ytInitialPlayerResponse`
 * → `videoDetails.shortDescription` に JSON エスケープ文字列として埋まっている。
 * {@link htmlToText} は `<script>` を除去するため、ここで専用に抜き出す。
 * 端末（ショートカット）が取得した HTML を関数に渡す前提（サーバー fetch は datacenter IP で
 * 弾かれるため）。DOM 非依存・依存ゼロで Deno/ブラウザ両対応。
 */

/**
 * YouTube URL から動画 ID を抽出する。該当しなければ null。
 * 対応: `watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`。
 */
export function youtubeVideoId(url: string): string | null {
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

/** YouTube のホストか判定する。 */
export function isYouTubeUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return (
      h === "youtube.com" ||
      h === "m.youtube.com" ||
      h === "music.youtube.com" ||
      h === "youtu.be"
    );
  } catch {
    return false;
  }
}

/** JSON エスケープされた文字列（`\n` `\uXXXX` 等）を復号する。失敗時は null。 */
function decodeJsonString(escaped: string): string | null {
  try {
    // 正規表現側で未エスケープの " を含まないことを保証しているので、囲って parse できる。
    return JSON.parse(`"${escaped}"`);
  } catch {
    return null;
  }
}

/**
 * watch ページ HTML から概要欄テキストを抽出する。見つからなければ null。
 *
 * `"shortDescription":"..."` を直接ターゲットにする（巨大な player response 全体を
 * JSON.parse せずに済ませ、堅牢性を上げる）。
 */
export function extractYouTubeDescription(html: string): string | null {
  const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  if (!m || m[1] === undefined) return null;
  const decoded = decodeJsonString(m[1]);
  const text = decoded?.trim() ?? "";
  return text.length > 0 ? text : null;
}

/** watch ページ HTML から動画タイトルを抽出する。見つからなければ null。 */
export function extractYouTubeTitle(html: string): string | null {
  // videoDetails.title を優先（`<title>` は " - YouTube" が付くため）。
  const jd = html.match(/"videoDetails":\{[^]*?"title":"((?:[^"\\]|\\.)*)"/);
  if (jd?.[1] !== undefined) {
    const t = decodeJsonString(jd[1])?.trim();
    if (t) return t;
  }
  const tag = html.match(/<title>([^<]*)<\/title>/i);
  if (tag?.[1]) {
    return tag[1].replace(/\s*-\s*YouTube\s*$/i, "").trim() || null;
  }
  return null;
}

/** 抽出したタイトル + 概要欄。 */
export interface YouTubeContent {
  title: string | null;
  description: string | null;
}

/** watch ページ HTML からタイトルと概要欄をまとめて抽出する。 */
export function extractYouTubeContent(html: string): YouTubeContent {
  return {
    title: extractYouTubeTitle(html),
    description: extractYouTubeDescription(html),
  };
}
