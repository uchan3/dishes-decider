/**
 * Gemini Flash 抽出プロバイダ（techstack §5）。
 *
 * API キーは Edge Function の環境変数 `GEMINI_API_KEY` からのみ読む
 * （PWA バンドルには絶対に含めない）。`responseSchema` で構造化 JSON を強制する。
 */

import {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  type ExtractionInput,
  type ExtractionProvider,
  type ProviderExtraction,
  type RecipeExtractionResult,
} from "@recipe-planner/core/extraction";

// モデル名は環境変数 GEMINI_MODEL で上書き可能（Google のモデル更新に追従するため）。
// 既定は現行 GA の Flash。無料枠のレート上限に触れる場合は gemini-3.5-flash-lite に切替。
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash";
const ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

/** Gemini のレスポンス JSON（必要部分のみ）。 */
interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** snake_case の抽出 JSON をドメイン結果 (camelCase) に変換する。 */
function toResult(raw: Record<string, unknown>): {
  result: RecipeExtractionResult;
  originalStepTexts: Record<number, string>;
} {
  const ingredients = Array.isArray(raw["ingredients"]) ? raw["ingredients"] : [];
  const steps = Array.isArray(raw["steps"]) ? raw["steps"] : [];
  const originalStepTexts: Record<number, string> = {};

  const mappedSteps = steps.map((s, i) => {
    const obj = s as Record<string, unknown>;
    const position = typeof obj["position"] === "number" ? obj["position"] : i + 1;
    const summary = typeof obj["summary"] === "string" ? obj["summary"] : null;
    // Gemini には手順の要約を返させるが、原文は本文にしか無い。
    // ここでは要約自身を原文プレースホルダとして扱わず、呼び出し側で本文と突合する。
    if (summary) originalStepTexts[position] = summary;
    return { position, summary };
  });

  return {
    result: {
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
      steps: mappedSteps,
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
    },
    originalStepTexts,
  };
}

export class GeminiProvider implements ExtractionProvider {
  readonly name = "gemini" as const;
  constructor(private readonly apiKey: string) {}

  async extract(input: ExtractionInput): Promise<ProviderExtraction> {
    const res = await fetch(ENDPOINT(GEMINI_MODEL, this.apiKey), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: `URL: ${input.url}\n\n本文:\n${input.text}` }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: EXTRACTION_JSON_SCHEMA,
          temperature: 0.2,
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini API エラー: HTTP ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini から空の応答");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Gemini の応答が JSON として解釈できません");
    }
    return toResult(parsed);
  }
}
