/**
 * JSON-LD (schema.org/Recipe) からの直接マッピング（仕様書 F-01-1 Tier 0）。
 *
 * 構造化データがあれば LLM を使わずに抽出できる（コスト 0・高精度）。
 * 手順(recipeInstructions)は schema.org 上「事実」寄りだが、原文表現を含むため
 * 呼び出し側で類似度ゲートに通す前提で `originalStepTexts` として返す。
 */

import type { ProviderExtraction, RecipeExtractionResult } from "./types.ts";

/** ISO8601 duration (例: "PT20M" / "PT1H30M") を分に変換する。失敗時は null。 */
export function parseIsoDurationToMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  if (!m) return null;
  const hours = m[1] ? Number(m[1]) : 0;
  const mins = m[2] ? Number(m[2]) : 0;
  const total = hours * 60 + mins;
  return total > 0 ? total : null;
}

/** servings 系（recipeYield）から人数を推定する。「4人分」「2」等に対応。 */
export function parseServings(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === "number") return raw > 0 ? Math.round(raw) : null;
  if (typeof raw !== "string") return null;
  const m = raw.match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** recipeInstructions を手順テキストの配列へ正規化する。 */
function extractInstructionTexts(value: unknown): string[] {
  const out: string[] = [];
  const pushText = (t: unknown) => {
    if (typeof t === "string" && t.trim() !== "") out.push(t.trim());
  };
  const visit = (node: unknown) => {
    if (node == null) return;
    if (typeof node === "string") {
      pushText(node);
    } else if (Array.isArray(node)) {
      for (const n of node) visit(n);
    } else if (typeof node === "object") {
      const obj = node as Record<string, unknown>;
      // HowToSection は itemListElement を展開。HowToStep は text/name。
      if (obj["itemListElement"]) visit(obj["itemListElement"]);
      else pushText(obj["text"] ?? obj["name"]);
    }
  };
  visit(value);
  return out;
}

/** recipeIngredient を材料配列へ正規化する（原文のみ。数量/単位は LLM/正規化に委ねる）。 */
function extractIngredients(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
}

/** name 配列/文字列から最初の文字列を得る。 */
function firstString(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

/**
 * schema.org/Recipe オブジェクトを {@link ProviderExtraction} にマッピングする。
 *
 * @param recipe - `@type` が `Recipe` の JSON-LD オブジェクト
 * @returns 抽出結果。手順原文は `originalStepTexts` に入れて返す（DB 非保存前提）
 */
export function mapJsonLdRecipe(recipe: Record<string, unknown>): ProviderExtraction {
  const title = firstString(recipe["name"]) ?? "無題のレシピ";
  const ingredientTexts = extractIngredients(
    recipe["recipeIngredient"] ?? recipe["ingredients"],
  );
  const instructionTexts = extractInstructionTexts(recipe["recipeInstructions"]);

  const originalStepTexts: Record<number, string> = {};
  instructionTexts.forEach((text, i) => {
    originalStepTexts[i + 1] = text;
  });

  const result: RecipeExtractionResult = {
    title,
    ingredients: ingredientTexts.map((raw) => ({
      rawText: raw,
      displayName: raw,
      quantity: null,
      unit: null,
    })),
    // JSON-LD の手順原文は要約前。summary は呼び出し側でゲート後に確定するため空にしておく。
    steps: instructionTexts.map((_, i) => ({ position: i + 1, summary: null })),
    cookTimeMin:
      parseIsoDurationToMinutes(recipe["totalTime"]) ??
      parseIsoDurationToMinutes(recipe["cookTime"]),
    servings: parseServings(recipe["recipeYield"]),
    dishRoles: [],
    mainIngredientCategory: null,
    cookingMethod: null,
    tags: [],
  };

  return { result, originalStepTexts };
}

/**
 * JSON-LD 文字列（`<script type="application/ld+json">` の中身）配列から
 * 最初の Recipe を探してマッピングする。見つからなければ null。
 *
 * `@graph` 形式や配列形式にも対応する。
 */
export function extractRecipeFromJsonLd(jsonLdBlocks: readonly string[]): ProviderExtraction | null {
  for (const block of jsonLdBlocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    const recipe = findRecipeNode(parsed);
    if (recipe) return mapJsonLdRecipe(recipe);
  }
  return null;
}

/** `@type` に "Recipe" を含むノードを再帰的に探す。 */
function findRecipeNode(node: unknown): Record<string, unknown> | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findRecipeNode(n);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const isRecipe = Array.isArray(type)
    ? type.some((t) => t === "Recipe")
    : type === "Recipe";
  if (isRecipe) return obj;
  if (obj["@graph"]) return findRecipeNode(obj["@graph"]);
  return null;
}
