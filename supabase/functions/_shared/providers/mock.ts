/**
 * モック抽出プロバイダ（ローカルテスト用）。
 *
 * Gemini / Claude のキーが無くてもパイプライン全体を動かせるよう、本文から
 * 素朴に材料行らしきものを拾って構造化する。品質は問わない（配線検証が目的）。
 */

import type {
  ExtractionInput,
  ExtractionProvider,
  ProviderExtraction,
} from "@recipe-planner/core/extraction";

export class MockProvider implements ExtractionProvider {
  readonly name = "gemini" as const; // 型上のプロバイダ名（実体はモック）

  extract(input: ExtractionInput): Promise<ProviderExtraction> {
    const lines = input.text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // 「食材 数量単位」らしい行を材料とみなす簡易ヒューリスティック。
    const ingredientLines = lines
      .filter((l) => /\d/.test(l) && l.length <= 30)
      .slice(0, 20);

    const stepLines = lines.filter((l) => l.length > 10 && !/\d+\s*(g|ml|個|本|枚)/.test(l)).slice(0, 6);

    return Promise.resolve({
      result: {
        title: input.titleHint ?? lines[0] ?? "抽出レシピ",
        ingredients: ingredientLines.map((raw) => ({
          rawText: raw,
          displayName: raw.replace(/[\d./]+.*$/, "").trim() || raw,
          quantity: null,
          unit: null,
        })),
        steps: stepLines.map((text, i) => ({
          position: i + 1,
          summary: text.slice(0, 60),
        })),
        cookTimeMin: null,
        servings: null,
        dishRoles: ["main"],
        mainIngredientCategory: null,
        cookingMethod: null,
        tags: [],
      },
      // モックは原文を手順原文としてそのまま返す（ゲート検証に使える）。
      originalStepTexts: Object.fromEntries(stepLines.map((t, i) => [i + 1, t])),
    });
  }
}
