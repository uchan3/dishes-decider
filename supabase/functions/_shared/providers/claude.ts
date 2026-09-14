/**
 * Claude Haiku 抽出プロバイダ（techstack §5.3 の品質フォールバック）。
 *
 * Gemini が再試行しても駄目なときの最後の受け皿。**有料**なので、
 * `ANTHROPIC_API_KEY` が設定されているときだけ {@link selectProvider} が鎖に足す
 * （未設定＝月額 0 円の構成のまま。設定して初めて課金経路が有効になる）。
 *
 * Haiku 4.5 の料金は入力 $1 / 出力 $5 per 1M トークン。1 レシピの抽出は本文数 KB
 * 程度なので、フォールバックが稀に走る分には無視できる額に収まる。
 *
 * API キーは Edge Function の環境変数からのみ読む（PWA バンドルには絶対に含めない）。
 */

import Anthropic from "npm:@anthropic-ai/sdk@0.125.0";
import {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  ProviderHttpError,
  type ExtractionInput,
  type ExtractionProvider,
  type ProviderExtraction,
  type RecipeExtractionResult,
} from "@recipe-planner/core/extraction";

/** 既定モデル。環境変数 `ANTHROPIC_MODEL` で上書きできる。 */
const DEFAULT_MODEL = "claude-haiku-4-5";

/**
 * 抽出結果を受け取るためのツール。
 *
 * 構造化出力の手段としてツール呼び出しを使う（`tool_choice` で必ず呼ばせる）。
 * 入力スキーマは Gemini と同じものを共有するので、**両プロバイダの出力が同じ形**に
 * なり、変換 {@link toResult} も 1 つで済む。`strict` は付けない
 * （共有スキーマが OpenAPI 風の `nullable` を使っており、厳密検証とは相性が悪い）。
 */
const SAVE_RECIPE_TOOL = {
  name: "save_recipe",
  description: "本文から抽出したレシピの事実データを渡す。",
  input_schema: EXTRACTION_JSON_SCHEMA as unknown as Anthropic.Tool["input_schema"],
} satisfies Anthropic.Tool;

/** snake_case の抽出 JSON をドメイン結果 (camelCase) に変換する。 */
function toResult(raw: Record<string, unknown>): RecipeExtractionResult {
  const ingredients = Array.isArray(raw["ingredients"]) ? raw["ingredients"] : [];
  const steps = Array.isArray(raw["steps"]) ? raw["steps"] : [];

  return {
    title: typeof raw["title"] === "string" ? raw["title"] : "抽出レシピ",
    ingredients: ingredients.map((ing) => {
      const o = ing as Record<string, unknown>;
      return {
        rawText: String(o["raw_text"] ?? o["display_name"] ?? ""),
        displayName: String(o["display_name"] ?? o["raw_text"] ?? ""),
        quantity: typeof o["quantity"] === "number" ? o["quantity"] : null,
        unit: typeof o["unit"] === "string" ? o["unit"] : null,
      };
    }),
    steps: steps.map((s, i) => {
      const o = s as Record<string, unknown>;
      return {
        position: typeof o["position"] === "number" ? o["position"] : i + 1,
        summary: typeof o["summary"] === "string" ? o["summary"] : null,
      };
    }),
    cookTimeMin: typeof raw["cook_time_min"] === "number" ? raw["cook_time_min"] : null,
    servings: typeof raw["servings"] === "number" ? raw["servings"] : null,
    dishRoles: Array.isArray(raw["dish_roles"]) ? (raw["dish_roles"] as never) : [],
    mainIngredientCategory:
      typeof raw["main_ingredient_category"] === "string"
        ? raw["main_ingredient_category"]
        : null,
    cookingMethod:
      typeof raw["cooking_method"] === "string" ? (raw["cooking_method"] as never) : null,
    tags: Array.isArray(raw["tags"]) ? (raw["tags"] as string[]) : [],
  };
}

export class ClaudeProvider implements ExtractionProvider {
  readonly name = "claude" as const;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string = Deno.env.get("ANTHROPIC_MODEL") ?? DEFAULT_MODEL) {
    // 再試行は呼び出し側（createFallbackProvider）が持つので SDK 側では切る。
    // 二重に効くと待ち時間が読めなくなり、有料呼び出しの回数も見えなくなる。
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
    this.model = model;
  }

  async extract(input: ExtractionInput): Promise<ProviderExtraction> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: 8000,
        system: EXTRACTION_SYSTEM_PROMPT,
        tools: [SAVE_RECIPE_TOOL],
        // 必ずツールとして返させる（地の文で JSON を書かれると解釈が不安定になる）。
        tool_choice: { type: "tool", name: SAVE_RECIPE_TOOL.name },
        messages: [
          {
            role: "user",
            content: `URL: ${input.url}\n\n本文:\n${input.text}`,
          },
        ],
      });
    } catch (err) {
      // ステータスを持たせ直して投げる（呼び出し側が再試行の可否を判断できるように）。
      if (err instanceof Anthropic.APIError) {
        throw new ProviderHttpError(err.status ?? 500, `Claude API エラー: ${err.message}`);
      }
      throw err;
    }

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) {
      throw new Error(`Claude がツールを呼びませんでした（stop_reason=${message.stop_reason}）`);
    }

    return {
      result: toResult(toolUse.input as Record<string, unknown>),
      // 手順の原文は LLM 経路には存在しない。ゲートは呼び出し側が入力本文全体と
      // 突合するため、ここは空のままにする（要約を原文に使わない）。
      originalStepTexts: {},
    };
  }
}
