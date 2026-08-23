/**
 * 献立生成のスコアリング（仕様書 F-02-2）。
 *
 *   score = w1 * recency   + w2 * favorite + w3 * novelty + w6 * pantry
 *         - w4 * variety   - w5 * reject
 *
 * 各サブスコアは概ね `[0, 1]` に正規化し、重みで強弱を付ける。
 */

import type { Recipe } from "../types/index.ts";

/** スコアの重み。すべて非負。ペナルティ項（variety / reject）は減算に用いる。 */
export interface ScoreWeights {
  /** recency: 最後に作ってから日数が長いほど高い。 */
  recency: number;
  /** favorite: お気に入りに加点。 */
  favorite: number;
  /** novelty: 調理回数が少ないほど高い（未調理を優遇）。 */
  novelty: number;
  /** variety: 直近採用と主要食材/調理法が被ると減点。 */
  variety: number;
  /** reject: 再抽選で弾かれた回数に応じて減点。 */
  reject: number;
  /** pantry: 家にある材料で作れるほど加点（docs/pantry.md §5）。 */
  pantry: number;
}

/** 既定の重み。novelty と recency をやや強め、favorite で好みを反映する。 */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  recency: 1.0,
  favorite: 0.8,
  novelty: 1.2,
  variety: 1.5,
  reject: 1.0,
  // 控えめ。在庫が偏っていても献立の多様性を壊さない強さにする。
  pantry: 0.8,
};

/** 1 日 = ミリ秒。 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 2 つの日付文字列 (YYYY-MM-DD) 間の日数差を返す。`from` から `to` までが正。
 * どちらかが不正な日付なら 0。
 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * recency スコア。最後に作ってからの経過日数を `horizonDays` で正規化して `[0, 1]`。
 * 未調理（`lastCookedAt` が null）は最大の 1 とする。
 */
export function recencyScore(
  recipe: Recipe,
  referenceDate: string,
  horizonDays: number,
): number {
  if (recipe.lastCookedAt === null) return 1;
  const horizon = horizonDays > 0 ? horizonDays : 1;
  const days = daysBetween(recipe.lastCookedAt, referenceDate);
  return Math.min(Math.max(days, 0) / horizon, 1);
}

/** novelty スコア。調理回数が少ないほど高い。`1 / (1 + cookCount)`。 */
export function noveltyScore(recipe: Recipe): number {
  return 1 / (1 + Math.max(0, recipe.cookCount));
}

/** reject ペナルティ。再抽選で弾かれた回数を 3 回で頭打ちに正規化。 */
export function rejectPenalty(recipe: Recipe): number {
  return Math.min(Math.max(0, recipe.rejectCount), 3) / 3;
}

/**
 * variety ペナルティ。既に採用済みのレシピと主要食材カテゴリ・調理法が被るほど高い。
 * 1 件被るごとに、カテゴリ一致で +0.5、調理法一致で +0.5 加算する。
 *
 * @param recipe - 評価対象
 * @param selected - この週で既に採用済みのレシピ群
 */
export function varietyPenalty(recipe: Recipe, selected: readonly Recipe[]): number {
  let penalty = 0;
  for (const other of selected) {
    if (
      recipe.mainIngredientCategory !== null &&
      recipe.mainIngredientCategory === other.mainIngredientCategory
    ) {
      penalty += 0.5;
    }
    if (recipe.cookingMethod !== null && recipe.cookingMethod === other.cookingMethod) {
      penalty += 0.5;
    }
  }
  return penalty;
}

/** スコアリングに必要なコンテキスト。 */
export interface ScoreContext {
  /** 基準日 (YYYY-MM-DD)。通常は「今日」。 */
  referenceDate: string;
  /** recency 正規化の地平線（日）。通常はクールダウン日数を用いる。 */
  horizonDays: number;
  /** この週で既に採用済みのレシピ群（variety ペナルティ算出用）。 */
  selected: readonly Recipe[];
  weights: ScoreWeights;
  /**
   * レシピ ID → 在庫適合度 `[0, 1]`（core の `matchPantry` の結果）。
   * 未指定・未収録のレシピは 0（無得点。ペナルティにはしない）。
   */
  pantryScores?: ReadonlyMap<string, number>;
}

/**
 * 1 レシピの総合スコアを算出する。
 *
 * @example
 * ```ts
 * const score = scoreRecipe(recipe, {
 *   referenceDate: "2026-07-30",
 *   horizonDays: 14,
 *   selected: [],
 *   weights: DEFAULT_WEIGHTS,
 * });
 * ```
 */
export function scoreRecipe(recipe: Recipe, ctx: ScoreContext): number {
  const { weights: w } = ctx;
  return (
    w.recency * recencyScore(recipe, ctx.referenceDate, ctx.horizonDays) +
    w.favorite * (recipe.isFavorite ? 1 : 0) +
    w.novelty * noveltyScore(recipe) +
    w.pantry * (ctx.pantryScores?.get(recipe.id) ?? 0) -
    w.variety * varietyPenalty(recipe, ctx.selected) -
    w.reject * rejectPenalty(recipe)
  );
}
