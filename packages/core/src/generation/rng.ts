/**
 * 決定論的な擬似乱数生成器とサンプリングユーティリティ。
 *
 * 献立生成は確率的（softmax サンプリング）だが、テストを再現可能にするため、
 * 乱数源を外から注入できるようにする。本番は `Math.random`、テストは `mulberry32` を渡す。
 */

/** `[0, 1)` の乱数を返す関数。`Math.random` と同じシグネチャ。 */
export type Rng = () => number;

/**
 * mulberry32: 高速でシード可能な 32bit 擬似乱数生成器。
 *
 * 暗号用途ではない（生成の再現性が目的）。同じシードからは常に同じ列を返す。
 *
 * @param seed - 初期シード（整数）
 * @returns `[0, 1)` の乱数を返す {@link Rng}
 *
 * @example
 * ```ts
 * const rng = mulberry32(42);
 * rng(); // 常に同じ最初の値
 * ```
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 重みリストからインデックスを 1 つ確率的にサンプリングする。
 *
 * 各要素が選ばれる確率はその重みに比例する（重みは非負であること）。
 * 全重みが 0 の場合は先頭（0）を返す。
 *
 * @param weights - 各候補の重み（非負）
 * @param rng - 乱数源
 * @returns サンプリングされたインデックス
 */
export function sampleIndex(weights: readonly number[], rng: Rng): number {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) return 0;

  let threshold = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    threshold -= Math.max(0, weights[i] ?? 0);
    if (threshold <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * スコア列を softmax で確率重みに変換する。
 *
 * 決定論的に上位を取ると毎回同じ献立になるため、スコアを温度付き softmax で
 * 確率化してからサンプリングする。数値安定化のため最大値を引く。
 *
 * @param scores - 各候補のスコア
 * @param temperature - 温度。高いほど一様に近づき、低いほど高スコアに集中する（既定 1）
 * @returns 合計 1 に正規化された確率重み
 */
export function softmax(scores: readonly number[], temperature = 1): number[] {
  if (scores.length === 0) return [];
  const t = temperature <= 0 ? 1e-6 : temperature;
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / t));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}
