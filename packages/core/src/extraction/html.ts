/**
 * HTML からの純粋な抽出ヘルパー（DOM 非依存）。
 *
 * Deno（Edge Function）は DOMParser を持たないため、正規表現ベースで処理する。
 * ブラウザ・Deno 双方で動くよう副作用ゼロ・依存ゼロに保つ。
 * LLM に投げる前に本文だけを抜くことで入力トークンを削減する（techstack §3.1）。
 */

/**
 * `<script type="application/ld+json">` ブロックの中身を配列で返す。
 * 見つからなければ空配列。
 */
export function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const content = (m[1] ?? "").trim();
    if (content) blocks.push(content);
  }
  return blocks;
}

/**
 * `<meta property="og:site_name">` からサイト名を返す。無ければ null。
 *
 * 収集元の表示名（F-01-2）に使う。ホスト名より読みやすい名前が取れる場合の補足であり、
 * 収集元の同定（identifier）はホスト名で行う。
 */
export function extractSiteName(html: string): string | null {
  const re =
    /<meta\b[^>]*?(?:property|name)=["']og:site_name["'][^>]*?content=["']([^"']*)["']/i;
  const reversed =
    /<meta\b[^>]*?content=["']([^"']*)["'][^>]*?(?:property|name)=["']og:site_name["']/i;
  const m = re.exec(html) ?? reversed.exec(html);
  const value = m?.[1]?.trim();
  return value ? decodeEntities(value) : null;
}

/** HTML エンティティの最小デコード（本文抽出に十分な範囲）。 */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/**
 * HTML をプレーンテキストに変換する（script/style/noscript を除去 → タグ除去 →
 * エンティティ復号 → 空白正規化）。LLM 抽出の入力や字幕・キャプション整形に使う。
 *
 * @param html - 変換元 HTML
 * @param maxLength - 上限文字数（既定 20000。超過分は切り詰め、トークン抑制）
 */
export function htmlToText(html: string, maxLength = 20000): string {
  const withoutBlocks = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const text = decodeEntities(withoutBlocks.replace(/<[^>]+>/g, " "));
  const collapsed = text.replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*\n\s*/g, "\n").trim();
  return collapsed.length > maxLength ? collapsed.slice(0, maxLength) : collapsed;
}
