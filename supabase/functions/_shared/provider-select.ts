/**
 * 環境に応じた抽出プロバイダの選択（techstack §5.3）。
 *
 * **無料のものから順に試し、駄目なら次へ落とす鎖**を組む:
 *
 *   1. Gemini Flash … 主経路（無料枠）
 *   2. Gemini Flash-Lite … 同じキーで**別枠のレート上限**を持つ軽量モデル。
 *      Flash が混雑して 429 を返す時間帯の逃げ道になる（ここまで料金 0 円）
 *   3. Claude Haiku … `ANTHROPIC_API_KEY` があるときだけ。**ここだけ有料**
 *
 * 鍵が 1 つも無ければ Mock（ローカル配線検証用）。
 *
 * これが無かった頃は Gemini が一度 429 を返しただけでジョブが `failed` になり、
 * ユーザーには手入力しか残らなかった。
 */

import {
  createFallbackProvider,
  type ExtractionInput,
  type ExtractionProvider,
  type ProviderExtraction,
} from "@recipe-planner/core/extraction";
import { GeminiProvider } from "./providers/gemini.ts";
import { MockProvider } from "./providers/mock.ts";

/**
 * Claude を**実際に使うときだけ** SDK を読み込むプロバイダ。
 *
 * Anthropic SDK は小さくないので、取り込みのたびに評価すると鎖の 1 段目しか使わない
 * 大多数のリクエストが余計なコールドスタートを払う。フォールバックが走った瞬間に
 * 動的 import する（これが呼ばれない限り SDK は評価されない）。
 */
function lazyClaudeProvider(apiKey: string): ExtractionProvider {
  return {
    name: "claude",
    async extract(input: ExtractionInput): Promise<ProviderExtraction> {
      const { ClaudeProvider } = await import("./providers/claude.ts");
      return new ClaudeProvider(apiKey).extract(input);
    },
  };
}

/** Flash が詰まったときに逃がす軽量モデル（レート上限が別枠）。 */
const GEMINI_LITE_MODEL = Deno.env.get("GEMINI_LITE_MODEL") ?? "gemini-3.5-flash-lite";

/**
 * 実行環境からプロバイダを組み立てる。
 *
 * 返るのは 1 つの {@link ExtractionProvider}。再試行とフォールバックは内側に畳まれて
 * いるので、パイプライン側は単一プロバイダと同じように扱える。
 */
export function selectProvider(): ExtractionProvider {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  const chain: ExtractionProvider[] = [];
  if (geminiKey) {
    chain.push(new GeminiProvider(geminiKey));
    chain.push(new GeminiProvider(geminiKey, GEMINI_LITE_MODEL));
  }
  if (anthropicKey) chain.push(lazyClaudeProvider(anthropicKey));
  if (chain.length === 0) chain.push(new MockProvider());

  return createFallbackProvider(chain, {
    // 1 レシピの取り込みは 5〜15 秒で終わる想定。待ちすぎるとショートカットから見て
    // 「止まっている」ジョブになるため、再試行は 1 回・待ちは 2 秒に抑える。
    maxRetries: 1,
    baseDelayMs: 2000,
    onAttemptFailed: ({ provider, attempt, error, willRetry, willFallBack }) => {
      const next = willRetry ? "retry" : willFallBack ? "fallback" : "give-up";
      console.log(`[extract] ${provider} attempt=${attempt} → ${next}: ${error.message}`);
    },
    onSuccess: ({ provider, attempt }) => {
      // どのプロバイダが実際に使われたかを残す（有料経路が走ったかを後から追える）。
      console.log(`[extract] ${provider} attempt=${attempt} → ok`);
    },
  });
}
