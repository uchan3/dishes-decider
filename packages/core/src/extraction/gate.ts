/**
 * 類似度ゲートの適用（仕様書 F-01-1「類似度ゲート」）。
 *
 * 各手順要約について原文との 3-gram 重複率を測り、閾値超過なら再生成（最大 2 回）。
 * それでも超過するなら要約を破棄（summary=null）して原典参照に置き換える。
 * 原文はこの処理までで使い切り、DB には保存しない（§3.4）。
 */

import { checkSimilarity } from "../similarity/index.ts";
import type { ExtractedStep } from "./types.ts";

/** 再生成コールバック。より簡潔・語順を変えた要約を返す（プロバイダ呼び出しを注入）。 */
export type RegenerateStep = (
  position: number,
  original: string,
  previousSummary: string,
  attempt: number,
) => Promise<string>;

/** ゲート適用の設定。 */
export interface GateOptions {
  /** 重複率の上限（私的利用 0.6 / 公開 0.4）。 */
  threshold: number;
  /** 再生成の最大回数（既定 2）。 */
  maxRetries?: number;
}

/**
 * 手順要約群に類似度ゲートを適用する。
 *
 * 原文が無い手順（`originalStepTexts` に無い）はゲート対象外でそのまま通す。
 *
 * @param steps - プロバイダが返した手順要約
 * @param originalStepTexts - position → 原文
 * @param regenerate - 再生成コールバック
 * @param options - 閾値・リトライ回数
 * @returns ゲート適用後の手順（破棄されたものは summary=null）
 */
export async function applySimilarityGate(
  steps: readonly ExtractedStep[],
  originalStepTexts: Readonly<Record<number, string>>,
  regenerate: RegenerateStep,
  options: GateOptions,
): Promise<ExtractedStep[]> {
  const maxRetries = options.maxRetries ?? 2;
  const out: ExtractedStep[] = [];

  for (const step of steps) {
    const original = originalStepTexts[step.position];
    // 原文が無い、または要約が無い手順はゲート不要。
    if (!original || step.summary === null) {
      out.push({ ...step });
      continue;
    }

    let summary = step.summary;
    let verdict = checkSimilarity(summary, original, options.threshold);
    let attempt = 0;
    while (verdict.exceeded && attempt < maxRetries) {
      attempt++;
      summary = await regenerate(step.position, original, summary, attempt);
      verdict = checkSimilarity(summary, original, options.threshold);
    }

    if (verdict.exceeded) {
      // 破棄して原典参照に置換（§3.4）。
      out.push({ position: step.position, summary: null, similarityScore: verdict.ratio });
    } else {
      out.push({ position: step.position, summary, similarityScore: verdict.ratio });
    }
  }

  return out;
}
