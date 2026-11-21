/**
 * Instagram 投稿のキャプション抽出（仕様書 F-01-1 / US-01）。
 *
 * **ログインは要らない。** 公開投稿の「埋め込みビュー」
 * （`/p/<shortcode>/embed/captioned/`）はキャプション全文を HTML に入れて返す。
 * レシピ系アカウントは材料と作り方をキャプションに書くので、これで十分な材料が取れる。
 *
 * ただし 2 つ条件がある（実測。2026-11）:
 *
 *   1. **ブラウザの User-Agent を送ってはいけない。** Chrome の UA だと JS アプリの
 *      外殻（約 540KB・キャプション無し）が返る。curl や `facebookexternalhit`、
 *      独自の UA なら埋め込み HTML（約 270KB・キャプション有り）が返る。
 *      空の UA は 302 になるので、何かしら名乗る必要がある
 *   2. **投稿ページ本体 (`/p/<code>/`) と oEmbed では取れない。** 前者は外殻のみ、
 *      後者（`graph.facebook.com/.../instagram_oembed`、トークン不要）は
 *      プレースホルダの blockquote だけでキャプションを含まない
 *
 * DOM 非依存・依存ゼロで Deno/ブラウザ両対応。
 */

/** Instagram のホストか判定する。 */
export function isInstagramUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

/**
 * Instagram URL から投稿の shortcode を取り出す。該当しなければ null。
 *
 * 対応: `/p/<code>`, `/reel/<code>`, `/reels/<code>`, `/tv/<code>`、および
 * アカウント名が前に付く形 `/<user>/p/<code>`（プロフィールから辿った URL）。
 *
 * @example
 * ```ts
 * instagramShortcode("https://www.instagram.com/p/Dcri0rk9Oi/?igsh=x"); // → "Dcri0rk9Oi"
 * instagramShortcode("https://www.instagram.com/5jipapa/reel/ABC_1/");  // → "ABC_1"
 * ```
 */
export function instagramShortcode(url: string): string | null {
  if (!isInstagramUrl(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const m = parsed.pathname.match(/(?:^|\/)(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

/**
 * キャプション付き埋め込みビューの URL。Instagram URL でなければ null。
 *
 * `/p/` と `/reel/` はどちらもこの形に正規化できる（実測で相互に通る）。
 */
export function instagramEmbedUrl(url: string): string | null {
  const code = instagramShortcode(url);
  return code === null ? null : `https://www.instagram.com/p/${code}/embed/captioned/`;
}

/**
 * 埋め込みビューに名乗る User-Agent。
 *
 * ブラウザを騙らない。騙るとむしろキャプション無しの外殻が返るうえ、素性を偽る
 * 必要も無いため（取得しているのは公開投稿の埋め込みビュー）。
 */
export const INSTAGRAM_FETCH_USER_AGENT = "dishes-decider/1.0 (recipe importer)";

/** 最小限の HTML エンティティ復号（キャプションに出るものだけ）。 */
function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&"); // 最後（&amp;lt; の二重復号を避ける）
}

/**
 * 埋め込みビューの HTML からキャプション本文を取り出す。無ければ null。
 *
 * **改行を保つ**のが肝心。キャプションの改行は `<br />` で表現されており、これを
 * 落とすと「▼材料」以下の箇条書きが 1 行に潰れて、材料の切り出し精度が落ちる。
 *
 * 先頭のアカウント名リンク（`CaptionUsername`）は本文ではないので捨てる。
 * ハッシュタグやメンションのリンクはテキストだけ残す。
 */
export function extractInstagramCaption(html: string): string | null {
  const start = html.search(/<div[^>]*class="[^"]*\bCaption\b[^"]*"[^>]*>/);
  if (start === -1) return null;
  const openEnd = html.indexOf(">", start);
  if (openEnd === -1) return null;
  const end = html.indexOf("</div>", openEnd);
  const inner = html.slice(openEnd + 1, end === -1 ? undefined : end);

  const text = unescapeHtml(
    inner
      // アカウント名リンクは本文ではない（キャプションの前に必ず入る）。
      .replace(/<a[^>]*class="[^"]*\bCaptionUsername\b[^"]*"[^>]*>[\s\S]*?<\/a>/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    // 行頭・行末の空白を落としつつ、空行は 1 つまでに畳む。
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text === "" ? null : text;
}

/**
 * 埋め込みビューの HTML から投稿者のアカウント名を取り出す。無ければ null。
 *
 * **収集元をアカウント単位に分けるために要る。** `/p/<code>/` 形式の URL は発信者を
 * 含まないので、URL だけだと Instagram の投稿が全部 1 つのソースに潰れて
 * 「今週はこの人のだけ」（US-03）が効かなくなる。
 */
export function extractInstagramUsername(html: string): string | null {
  const m = html.match(
    /<a[^>]*class="[^"]*\bCaptionUsername\b[^"]*"[^>]*>([^<]+)<\/a>/,
  );
  const name = m?.[1]?.trim().toLowerCase();
  return name ? name : null;
}
