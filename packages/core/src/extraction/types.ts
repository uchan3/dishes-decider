/**
 * レシピ抽出の共有型（仕様書 F-01-1）。
 *
 * 抽出パイプラインは Deno（Edge Function）で走るが、結果の型はブラウザ側でも使うため
 * core に置く。プロバイダ（Gemini / Claude / Ollama）はこの型を実装して差し替える。
 */

import type { CookingMethod, DishRole, IngredientCategory } from "../types/index.ts";

/** 抽出された 1 材料（原文に忠実。事実データ）。 */
export interface ExtractedIngredient {
  /** 抽出元の原文（例: 「玉ねぎ 1/2個」）。 */
  rawText: string;
  displayName: string;
  /** 数量。曖昧量（適量・少々）や不明は null。 */
  quantity: number | null;
  /** 単位（例: `個` / `g` / `大さじ`）。 */
  unit: string | null;
}

/** 抽出された 1 手順（AI 要約。原文は保持しない）。 */
export interface ExtractedStep {
  position: number;
  /** 事実のみに正規化した要約。破棄された場合は null（原典参照に置換）。 */
  summary: string | null;
  /** 類似度ゲートの重複率（記録用）。 */
  similarityScore?: number;
}

/** 抽出結果（DB に保存する構造化データ）。 */
export interface RecipeExtractionResult {
  title: string;
  ingredients: ExtractedIngredient[];
  steps: ExtractedStep[];
  cookTimeMin: number | null;
  servings: number | null;
  dishRoles: DishRole[];
  mainIngredientCategory: string | null;
  cookingMethod: CookingMethod | null;
  tags: string[];
  /** 主要食材カテゴリ（売場分類の初期推定に利用可）。 */
  ingredientCategoryHint?: IngredientCategory | null;
}

/** 抽出プロバイダへの入力。 */
export interface ExtractionInput {
  /** 原典 URL。 */
  url: string;
  /** 取得済みの本文テキスト（HTML 本文 / 概要欄 / キャプション / 字幕）。 */
  text: string;
  /** タイトルヒント（取得できていれば）。 */
  titleHint?: string | null;
}

/**
 * 抽出プロバイダのインタフェース（techstack §5.3）。
 * Edge Function 内でこれを実装し、Gemini↔Claude↔Ollama を差し替える。
 */
export interface ExtractionProvider {
  readonly name: "gemini" | "claude" | "ollama";
  /**
   * 本文から構造化レシピを抽出する。手順は事実のみの要約にすること。
   * `originalStepTexts` に手順の原文（あれば）を返すと、呼び出し側が類似度ゲートに使える。
   */
  extract(input: ExtractionInput): Promise<ProviderExtraction>;
}

/** プロバイダの生の出力。類似度ゲートを通す前の段階。 */
export interface ProviderExtraction {
  result: RecipeExtractionResult;
  /**
   * 手順の原文（position をキーにした要約検査用）。取得できない場合は空。
   * 原文はここまでで使い、DB には保存しない（§3.4）。
   */
  originalStepTexts: Record<number, string>;
}

/** 抽出の経路（品質階層・記録用）。 */
export type ExtractionMethod =
  | "jsonld"
  | "llm_text"
  | "llm_caption"
  | "llm_ocr"
  | "manual";
