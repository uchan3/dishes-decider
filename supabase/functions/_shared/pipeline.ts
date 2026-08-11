/**
 * 抽出パイプラインのオーケストレーション（architecture §3）。
 *
 *   取得 → JSON-LD 高速経路（あれば LLM スキップ）または LLM 抽出 →
 *   類似度ゲート → 原文破棄 → 構造化結果。
 *
 * 原文はこの関数内で使い切り、返り値・DB には残さない（§3.4）。
 */

import {
  applySimilarityGate,
  extractJsonLdBlocks,
  extractRecipeFromJsonLd,
  extractYouTubeContent,
  htmlToText,
  isYouTubeUrl,
  youtubeVideoId,
  SIMILARITY_THRESHOLDS,
  type ExtractionMethod,
  type ExtractionProvider,
  type RecipeExtractionResult,
} from "@recipe-planner/core/extraction";
import { safeFetch } from "./fetch.ts";
import { fetchYouTubeSnippet } from "./youtube-api.ts";

/** パイプラインの結果（DB に保存できる構造化データのみ）。 */
export interface PipelineResult {
  result: RecipeExtractionResult;
  method: ExtractionMethod;
  finalUrl: string;
}

/** パイプライン設定。 */
export interface PipelineOptions {
  /** 手順要約の再生成に使うプロバイダ（LLM）。 */
  provider: ExtractionProvider;
  /** 類似度閾値（既定: 私的利用 0.6）。 */
  threshold?: number;
}

/** 事前取得コンテンツの種別。 */
export type ContentKind = "html" | "text";

/**
 * URL からレシピを抽出する（サーバー側 fetch 経路）。
 *
 * JSON-LD が取れれば LLM をスキップ（コスト 0）。取れなければ本文を LLM に投げる。
 * Bot 対策サイト（Cloudflare・YouTube 等）はデータセンター IP から弾かれるため、
 * その場合は {@link extractFromContent}（端末側で取得した本文を渡す経路）を使う。
 */
export async function runExtraction(
  url: string,
  options: PipelineOptions,
): Promise<PipelineResult> {
  // YouTube は Data API で概要欄を直接取得（HTML スクレイプ不要・確実）。
  const yt = await maybeExtractYouTube(url, options);
  if (yt) return yt;

  const fetched = await safeFetch(url);
  return extractFromContent(fetched.finalUrl, fetched.body, "html", options);
}

/**
 * YouTube URL なら Data API で snippet を取得して LLM 抽出する。
 * `YOUTUBE_API_KEY` 未設定・非 YouTube・ID 不明・snippet 無しなら null（呼び出し側は
 * 従来の HTML/content 経路にフォールバック）。
 */
async function maybeExtractYouTube(
  url: string,
  options: PipelineOptions,
): Promise<PipelineResult | null> {
  if (!isYouTubeUrl(url)) return null;
  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!apiKey) return null;
  const videoId = youtubeVideoId(url);
  if (!videoId) return null;

  const snippet = await fetchYouTubeSnippet(videoId, apiKey);
  if (!snippet || snippet.description.trim() === "") {
    console.log(`[pipeline] youtube-api: videoId=${videoId} description empty`);
    return null;
  }
  console.log(`[pipeline] youtube-api: videoId=${videoId} descLen=${snippet.description.length}`);
  const text = `タイトル: ${snippet.title}\n\n${snippet.description}`;
  return llmExtract(url, text, snippet.title, options);
}

/**
 * 事前取得済みのコンテンツからレシピを抽出する（サーバー fetch を行わない経路）。
 *
 * iOS ショートカット / PWA が端末側でページ本文（HTML）や動画概要欄（テキスト）を
 * 取得して渡す。これにより Bot 対策サイトでもユーザー端末からのアクセス扱いになる。
 *
 * @param url - 原典 URL（保存・表示用。この関数は fetch しない）
 * @param content - 取得済みの本文（HTML または プレーンテキスト）
 * @param kind - `html` なら JSON-LD 高速経路を試す。`text` は LLM 抽出のみ
 */
export async function extractFromContent(
  url: string,
  content: string,
  kind: ContentKind,
  options: PipelineOptions,
): Promise<PipelineResult> {
  console.log(
    `[pipeline] extractFromContent kind=${kind} contentLen=${content.length} ` +
      `youtube=${isYouTubeUrl(url)} url=${url}`,
  );

  // YouTube は Data API 経路を優先（HTML content は可視テキスト化で概要欄が失われるため）。
  const yt = await maybeExtractYouTube(url, options);
  if (yt) return yt;

  const threshold = options.threshold ?? SIMILARITY_THRESHOLDS.private;

  // Tier 0: HTML なら JSON-LD 直接マッピングを試す。
  if (kind === "html") {
    const jsonLd = extractRecipeFromJsonLd(extractJsonLdBlocks(content));
    if (jsonLd && jsonLd.result.ingredients.length > 0) {
      const gatedSteps = await gateSteps(
        jsonLd.result,
        jsonLd.originalStepTexts,
        options.provider,
        threshold,
      );
      return {
        result: { ...jsonLd.result, steps: gatedSteps },
        method: "jsonld",
        finalUrl: url,
      };
    }
  }

  // Tier 1/2: 本文を LLM に投げる。
  // YouTube キー未設定時のフォールバック: watch HTML の概要欄を抜く（不確実）。
  let text: string;
  let titleHint: string | null = null;
  if (kind === "html" && isYouTubeUrl(url)) {
    const parsed = extractYouTubeContent(content);
    titleHint = parsed.title;
    const body = parsed.description ?? htmlToText(content);
    text = parsed.title ? `タイトル: ${parsed.title}\n\n${body}` : body;
  } else {
    text = kind === "html" ? htmlToText(content) : content;
  }
  return llmExtract(url, text, titleHint, options);
}

/**
 * 本文テキストを LLM に投げて構造化し、類似度ゲートを適用する（LLM 経路の共通処理）。
 *
 * per-step の原文は無いため、各要約は「入力本文全体」と突合する。再生成は無料枠を
 * 圧迫するため行わず（maxRetries=0）、超過した要約は破棄して原典参照に置き換える。
 */
async function llmExtract(
  url: string,
  text: string,
  titleHint: string | null,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const threshold = options.threshold ?? SIMILARITY_THRESHOLDS.private;
  const extraction = await options.provider.extract({ url, text, titleHint });
  const sourceOriginals: Record<number, string> = {};
  for (const step of extraction.result.steps) sourceOriginals[step.position] = text;
  const gatedSteps = await gateSteps(
    extraction.result,
    sourceOriginals,
    options.provider,
    threshold,
    0,
  );
  return {
    result: { ...extraction.result, steps: gatedSteps },
    method: "llm_text",
    finalUrl: url,
  };
}

/**
 * 手順要約に類似度ゲートを適用する。
 *
 * @param maxRetries - 超過時の再生成回数。0 なら再生成せず破棄（無料枠節約・LLM 経路）。
 *   JSON-LD 経路は summary が null のためゲート自体がスキップされ LLM 呼び出しは発生しない。
 */
function gateSteps(
  result: RecipeExtractionResult,
  originalStepTexts: Record<number, string>,
  provider: ExtractionProvider,
  threshold: number,
  maxRetries = 2,
) {
  return applySimilarityGate(
    result.steps,
    originalStepTexts,
    async (_position, original, previous) => {
      // 再生成が要る場合のみ呼ばれる（maxRetries>0）。該当原文を渡して離れた要約を得る。
      const re = await provider.extract({ url: "", text: original, titleHint: previous });
      return re.result.steps[0]?.summary ?? previous;
    },
    { threshold, maxRetries },
  );
}
