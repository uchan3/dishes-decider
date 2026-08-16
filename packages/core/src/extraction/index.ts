/** レシピ抽出の公開 API（共有型・JSON-LD 高速経路・類似度ゲート・プロンプト）。 */
export type {
  ExtractedIngredient,
  ExtractedStep,
  RecipeExtractionResult,
  ExtractionInput,
  ExtractionProvider,
  ProviderExtraction,
  ExtractionMethod,
} from "./types.ts";
export {
  mapJsonLdRecipe,
  extractRecipeFromJsonLd,
  parseIsoDurationToMinutes,
  parseServings,
} from "./jsonld.ts";
export { applySimilarityGate, type RegenerateStep, type GateOptions } from "./gate.ts";
export { extractJsonLdBlocks, extractSiteName, htmlToText } from "./html.ts";
export {
  isYouTubeUrl,
  youtubeVideoId,
  extractYouTubeDescription,
  extractYouTubeTitle,
  extractYouTubeContent,
  type YouTubeContent,
} from "./youtube.ts";
export {
  deriveSource,
  type DerivedSource,
  type SourceHint,
  type SourceKind,
} from "./source.ts";
export {
  validateExternalUrl,
  isInternalHost,
  isPrivateIpv4,
  type UrlCheck,
} from "./url.ts";
export {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  buildRegeneratePrompt,
} from "./prompt.ts";
// 抽出パイプラインが閾値を使うため similarity から再エクスポート。
export { SIMILARITY_THRESHOLDS, checkSimilarity, overlapRatio } from "../similarity/index.ts";
