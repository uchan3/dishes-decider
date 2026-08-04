/**
 * 文字 3-gram による類似度計算（仕様書 §3.4 原則2・F-01-1 類似度ゲート）。
 *
 * 著作権制約の中核。AI 要約が原文の表現をなぞっていないか機械的に検査するため、
 * 要約と原文の文字 3-gram の重複率を測る。閾値（私的利用 0.6 / 公開 0.4）を超えたら
 * 再生成し、それでも駄目なら要約を破棄する。
 *
 * このモジュールは Deno（抽出パイプライン）で実行される。依存ゼロ・Node 組み込み不使用。
 */

/** 比較の前処理: NFKC 正規化 → 空白・改行・約物を除去 → 小文字化。 */
function normalizeForCompare(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\s　]+/g, "")
    .replace(/[、。，．・！？!?,.「」『』（）()]/g, "")
    .toLowerCase();
}

/**
 * 文字 3-gram の集合を作る。長さ 3 未満の文字列は、それ自体を 1 要素とする。
 *
 * @param text - 対象文字列
 * @returns 3-gram の集合（重複排除済み）
 */
export function trigrams(text: string): Set<string> {
  const s = normalizeForCompare(text);
  const chars = [...s]; // サロゲートペア対応
  const set = new Set<string>();
  if (chars.length === 0) return set;
  if (chars.length < 3) {
    set.add(chars.join(""));
    return set;
  }
  for (let i = 0; i <= chars.length - 3; i++) {
    set.add(chars.slice(i, i + 3).join(""));
  }
  return set;
}

/**
 * 要約が原文からどれだけ 3-gram を借用しているかの重複率を返す（0〜1）。
 *
 * 分母は「要約の 3-gram 数」（＝要約側から見た借用率）。要約が原文の表現をそのまま
 * なぞるほど 1 に近づく。要約・原文いずれかが空なら 0。
 *
 * @param summary - AI が生成した手順要約
 * @param original - 取得した原文
 * @returns 要約の 3-gram のうち原文に含まれる割合
 *
 * @example
 * ```ts
 * overlapRatio("豚肉を炒める", "豚肉を炒めて醤油を加える"); // 高い（表現が近い）
 * overlapRatio("肉を焼く", "野菜を茹でる");                   // 低い
 * ```
 */
export function overlapRatio(summary: string, original: string): number {
  const a = trigrams(summary);
  if (a.size === 0) return 0;
  const b = trigrams(original);
  if (b.size === 0) return 0;
  let shared = 0;
  for (const g of a) {
    if (b.has(g)) shared++;
  }
  return shared / a.size;
}

/** 類似度ゲートの判定結果。 */
export interface SimilarityVerdict {
  ratio: number;
  /** 閾値を超過し、再生成/破棄が必要か。 */
  exceeded: boolean;
}

/**
 * 要約が閾値を超えて原文に類似しているか判定する。
 *
 * @param summary - AI 要約
 * @param original - 原文
 * @param threshold - 重複率の上限（私的利用 0.6 / 公開 0.4）
 */
export function checkSimilarity(
  summary: string,
  original: string,
  threshold: number,
): SimilarityVerdict {
  const ratio = overlapRatio(summary, original);
  return { ratio, exceeded: ratio > threshold };
}

/** 類似度ゲートの既定閾値。 */
export const SIMILARITY_THRESHOLDS = {
  /** 私的利用。 */
  private: 0.6,
  /** 公開サービス。 */
  public: 0.4,
} as const;
