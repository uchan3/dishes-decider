/**
 * 抽出プロンプトと出力スキーマ（仕様書 F-01-1「抽出プロンプトの仕様」）。
 *
 * スキーマは **Gemini `responseSchema`（OpenAPI 3.0 サブセット）互換**で書く。
 * 標準 JSON Schema と違い、`type` にユニオン配列（例 `["number","null"]`）は使えず、
 * null 許容は `nullable: true`、enum は単一 `type` と併記する。Claude のツール入力
 * （JSON Schema）はこの形も受理する（未知キーワードは無視される）。
 * プロンプト本文は「手順は事実のみに正規化」制約を明文化する（§3.4 原則2）。
 */

/** 抽出の出力スキーマ（Gemini responseSchema 互換）。 */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          raw_text: { type: "string" },
          display_name: { type: "string" },
          quantity: { type: "number", nullable: true },
          unit: { type: "string", nullable: true },
        },
        required: ["raw_text", "display_name"],
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          position: { type: "integer" },
          summary: { type: "string" },
        },
        required: ["position", "summary"],
      },
    },
    cook_time_min: { type: "integer", nullable: true },
    servings: { type: "integer", nullable: true },
    dish_roles: {
      type: "array",
      items: { type: "string", enum: ["main", "side", "one_dish", "soup", "staple"] },
    },
    main_ingredient_category: { type: "string", nullable: true },
    // cooking_method は nullable のため enum を付けず、プロンプトで値を制約する
    // （nullable と enum の併用は null 非許容と衝突しうるため）。
    cooking_method: { type: "string", nullable: true },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["title", "ingredients", "steps"],
} as const;

/** 抽出の指示プロンプト（本文テキストを与えて構造化 JSON を得る）。 */
export const EXTRACTION_SYSTEM_PROMPT = `あなたは料理レシピの構造化抽出器です。与えられた本文から、買い物リストと献立生成に必要な事実のみを抽出し、指定された JSON スキーマで返してください。

# 材料（事実データ・原文に忠実に）
- 原文の表記を尊重して抽出する。抽出できない項目は null にし、推測で埋めない。
- raw_text は原文の該当行、display_name は**食材名だけ**（分量・単位・切り方を含めない）。
  例: 「にんにく 1かけ」→ display_name は「にんにく」、quantity は 1、unit は「かけ」。
- quantity/unit は数値化できる場合のみ。「適量」「少々」は quantity/unit を null にする。

# 手順の要約 ── 意図的に無味乾燥にする（重要）
- 体言止めまたは命令形の短文に正規化する。1 ステップ 60 文字以内。
- 形容詞・副詞・話し言葉・比喩・作者の語り口を排除する。
- 「コツ」「おすすめ」等の解説文・主観は取り込まない。
- 温度・時間・分量などの数値は事実なので保持する。
- 原文の語順・言い回しをなぞらず、動作と対象を再構成して記述する。

# その他
- dish_roles / cooking_method は定義済みの値のみ。
- 出力は JSON のみ。`;

/** 手順の再生成プロンプト（類似度ゲート超過時）。 */
export function buildRegeneratePrompt(original: string, previousSummary: string): string {
  return `次の手順要約が原文の表現に近すぎます。事実（動作・対象・数値）は保ちつつ、より簡潔に、語順と言い回しを変えて再記述してください。60 文字以内、体言止めまたは命令形。

原文: ${original}
現在の要約: ${previousSummary}

再記述した要約のみを返してください。`;
}
