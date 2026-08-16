/**
 * 食材名の正規化（仕様書 §5.3）。
 *
 * 表記ゆれ（玉ねぎ / たまねぎ / 玉葱 / タマネギ）を照合するための正規化キーを作る。
 * 手動入力（apps/web）と抽出パイプライン（supabase/functions）の両方から使うため、
 * 依存ゼロの純粋関数として core に置く。
 *
 * 手順: NFKC 正規化 → カタカナをひらがな化 → 空白除去 → 小文字化。
 * 漢字の揺れ（玉葱↔玉ねぎ）はこの関数だけでは吸収できないため、呼び出し側で
 * エイリアス辞書と併用する。
 */

/** カタカナ (U+30A1–U+30F6) をひらがなに変換する。 */
function katakanaToHiragana(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCodePoint(code - 0x60);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * 食材名を照合用の正規化キーに変換する。
 *
 * @example
 * ```ts
 * normalizeIngredientName("タマネギ");   // "たまねぎ"
 * normalizeIngredientName("玉ねぎ　");   // "玉ねぎ"（全角空白を除去）
 * normalizeIngredientName("Ｔｏｆｕ");   // "tofu"（NFKC + 小文字化）
 * ```
 */
export function normalizeIngredientName(raw: string): string {
  const nfkc = raw.normalize("NFKC");
  const hira = katakanaToHiragana(nfkc);
  return hira.replace(/[\s　]/g, "").toLowerCase();
}
