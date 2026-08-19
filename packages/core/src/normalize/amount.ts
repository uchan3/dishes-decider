/**
 * 食材名から末尾の分量を取り除く（仕様書 §5.3）。
 *
 * 抽出（LLM）は `display_name` に食材名だけを入れる約束だが、実際には
 * 「にんにく 1かけ」「醤油 大さじ2」のように**分量が混ざった名前**が返ることがある。
 * そのまま食材マスタを作ると「にんにく」と「にんにく 1かけ」が別物になり、
 * 買い物リストで合算されない。マスタを作る前にここで名前を整える。
 *
 * 取り除くのは**末尾**の分量だけ。「3色ピーマン」のように先頭の数字は食材名の一部なので残す。
 */

/** 数値（半角/全角、小数、分数、範囲、Unicode 分数）。 */
const NUMBER = "(?:[0-9０-９]+(?:[.．][0-9０-９]+)?(?:\\s*[/／∕]\\s*[0-9０-９]+)?|[½¼¾⅓⅔])";
const RANGE = `${NUMBER}(?:\\s*[~〜\\-−–]\\s*${NUMBER})?`;

/** 数値の後ろに付く単位。「1カップ」のように前置きの単位が後ろに来る書き方も拾う。 */
const UNIT =
  "(?:g|ｇ|kg|mg|ml|mL|cc|l|L|リットル|cm|mm|カップ|大さじ|小さじ|個|本|枚|束|把|パック|丁|片|かけ|かけら|玉|株|房|缶|袋|尾|匹|切れ|杯|合|人分|人前|膳|つまみ|振り|滴)?";

/** 数値の前に付く単位（「大さじ2」形式）。 */
const PREFIX_UNIT = "(?:大さじ|小さじ|カップ|コップ|おたま|ひとつまみ)";

/** 数値を伴わない分量語。 */
const VAGUE = "(?:各?適量|各?少々|少量|ひとつまみ|ひとつかみ|お好みで|好みで|適宜)";

/** 末尾から剥がす分量チャンク。 */
const TRAILING = new RegExp(
  "(?:" +
    [
      `[（(]\\s*(?:${PREFIX_UNIT}\\s*${RANGE}|${RANGE}\\s*${UNIT}|${VAGUE})\\s*[）)]`,
      `${PREFIX_UNIT}\\s*${RANGE}`,
      `${RANGE}\\s*${UNIT}`,
      VAGUE,
    ].join("|") +
    ")\\s*$",
);

/** 剥がした後に残る区切り文字。 */
const TRAILING_SEPARATOR = /[\s、,，・:：/／]+$/;

/**
 * 食材名の末尾に付いた分量を取り除く。
 *
 * 取り除いた結果が空になる場合（名前が分量そのものだった場合）は元の文字列を返す。
 *
 * @example
 * ```ts
 * stripAmountFromIngredientName("にんにく 1かけ");   // "にんにく"
 * stripAmountFromIngredientName("醤油 大さじ2");     // "醤油"
 * stripAmountFromIngredientName("玉ねぎ（1/2個）");  // "玉ねぎ"
 * stripAmountFromIngredientName("3色ピーマン");      // "3色ピーマン"（先頭の数字は残す）
 * ```
 */
export function stripAmountFromIngredientName(raw: string): string {
  let name = raw.trim();
  // 「玉ねぎ 1/2個 みじん切り」のような後置きの語には対応しない（末尾のみを見る）。
  for (let i = 0; i < 3; i++) {
    const stripped = name.replace(TRAILING, "").replace(TRAILING_SEPARATOR, "").trim();
    if (stripped === name) break;
    name = stripped;
  }
  return name === "" ? raw.trim() : name;
}
