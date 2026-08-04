/**
 * 抽出プロンプトと出力スキーマ（仕様書 F-01-1「抽出プロンプトの仕様」）。
 *
 * Gemini の `responseSchema` と Claude のツール入力の双方で使えるよう、
 * JSON スキーマ相当を定数で持つ。プロンプト本文は「手順は事実のみに正規化し、
 * 語り口・形容詞・比喩を排除する」制約を明文化する（§3.4 原則2）。
 */

/** 抽出の出力 JSON スキーマ（プロバイダ非依存）。 */
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
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
        },
        required: ["raw_text", "display_name"],
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          position: { type: "number" },
          summary: { type: "string" },
        },
        required: ["position", "summary"],
      },
    },
    cook_time_min: { type: ["number", "null"] },
    servings: { type: ["number", "null"] },
    dish_roles: {
      type: "array",
      items: { enum: ["main", "side", "one_dish", "soup", "staple"] },
    },
    main_ingredient_category: { type: ["string", "null"] },
    cooking_method: { type: ["string", "null"], enum: ["fry", "simmer", "grill", "steam", "raw", null] },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["title", "ingredients", "steps"],
} as const;

/** 抽出の指示プロンプト（本文テキストを与えて構造化 JSON を得る）。 */
export const EXTRACTION_SYSTEM_PROMPT = `あなたは料理レシピの構造化抽出器です。与えられた本文から、買い物リストと献立生成に必要な事実のみを抽出し、指定された JSON スキーマで返してください。

# 材料（事実データ・原文に忠実に）
- 原文の表記を尊重して抽出する。抽出できない項目は null にし、推測で埋めない。
- raw_text は原文の該当行、display_name は食材名、quantity/unit は数値化できる場合のみ。

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
