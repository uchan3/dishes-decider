/**
 * 環境に応じた抽出プロバイダの選択。
 *
 * `GEMINI_API_KEY` があれば Gemini、無ければ Mock（ローカル配線検証用）。
 * 将来 Claude Haiku フォールバックを Tier 2 として差し込む余地を残す。
 */

import type { ExtractionProvider } from "@recipe-planner/core/extraction";
import { GeminiProvider } from "./providers/gemini.ts";
import { MockProvider } from "./providers/mock.ts";

/** 実行環境からプロバイダを 1 つ選ぶ。 */
export function selectProvider(): ExtractionProvider {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey) return new GeminiProvider(geminiKey);
  return new MockProvider();
}
