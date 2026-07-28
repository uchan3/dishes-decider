# 週間献立プランナー 仕様書 v0.3

> ステータス: Draft / SDD の Spec フェーズ成果物
> 最終更新: 2026-07-28
>
> **v0.3 の変更点**: 手順の扱いを **「AI 要約 + 公式埋め込みのハイブリッド」** に確定。原文の永続保存を廃止したことで、私的利用／公開サービスの分岐に依存しない構造になった。§3.4 / §3.6 / F-01 / F-05 / データモデルを改訂。
>
> v0.2: レシピ収集を「リンク＋メタデータのみ」から AI による構造化抽出を主経路とする方式に変更。§3 の法的整理を全面改訂。

---

## 1. 目的とゴール

### 1.1 解決したい課題

- 毎日の「今日何作る？」の意思決定コストが高い
- 気に入ったレシピが Instagram の保存・YouTube の再生リスト・ブラウザのブックマークに散在し、献立を組むときに参照されない
- 買い出し時に「何をどれだけ買えばいいか」が分からず、買い忘れ・重複購入が発生する

### 1.2 ゴール

1. 複数ソースから集めたレシピを 1 箇所のライブラリに集約する
2. ライブラリから 1 週間分の献立を自動生成し、気に入らない部分だけをピンポイントで再抽選できる
3. 献立から買い物リストを自動生成し、買い出し中に TODO として消化できる

### 1.3 成功指標 (MVP)

| 指標 | 目標値 |
|---|---|
| 献立生成〜確定までの操作時間 | 3 分以内 |
| 生成された献立のうち再抽選される割合 | 30% 未満 |
| 買い物リストの手動追加率 | 20% 未満（＝自動集約の網羅性） |
| 週次リテンション（週1回以上献立生成） | 40% 以上 |

---

## 2. スコープ

### 2.1 MVP スコープ

- レシピの登録（URL 共有 / 手動入力）と構造化
- ソース単位の有効・無効切り替え
- 1 週間 × 夕食の献立自動生成
- スロット / 食事 / 週単位の再抽選、ロック
- 献立構成のカスタマイズ（主菜+副菜、主菜のみ、一皿完結 など）
- 食材の集約と買い物リスト（チェック管理）

### 2.2 非スコープ（将来検討）

- 朝食・昼食の献立（データモデルでは拡張可能にしておく）
- 栄養価計算・PFC バランス最適化
- 家族間でのリアルタイム共同編集
- ネットスーパー連携・自動発注
- 在庫（パントリー）管理の厳密な自動消し込み

---

## 3. 制約と前提（設計の根幹）

### 3.1 参考事例：クックパッド「レシピスクラップ」（2026年3月）

本仕様が採用する AI 抽出方式は、クックパッドが 2026 年 3 月にリリースした「レシピスクラップ」と同型である。同機能は Instagram / TikTok / X / 個人サイトの URL を貼ると AI が材料・分量・手順・写真を抽出しアプリ内に保存するもので、無料会員は週 5 件、プレミアム会員は無制限という設計だった。

リリース後、料理研究家から強い批判を受け、クックパッドは仕様を含めた見直しを表明している。批判の中心となったのは、**本プロジェクトが主要な収集元として想定しているリュウジ氏**であり、「元投稿にアクセスせずアプリ内で完結する構造は製作者へのリスペクトがない」という趣旨の指摘だった。白ごはん.com 運営者からも、サーバー費用を自己負担する個人発信者にとって運用継続が危うくなるとの懸念が示された。

**この事例は「AI 抽出であれば著作権をクリアできる」ことの証明ではない。** むしろ、
- 何を保存・出力するか
- 私的利用に留めるか、事業として提供するか
- 元投稿への導線をどう設計するか

の 3 点を誤ると、法的評価以前に発信者コミュニティからの支持を失うという教訓として扱う。

### 3.2 法的整理

> 筆者は弁護士ではない。公開サービス化を判断する段階では専門家の確認を取ること。

**レイヤ分解：**

| 対象 | 著作物性 | 本アプリでの扱い |
|---|---|---|
| レシピのアイデア（この材料をこう調理する） | なし | 自由に利用可 |
| 材料名・分量のリスト | 極めて薄い（事実の列挙） | **抽出・保存・再構成してよい**（買い物リストの根拠） |
| 手順の文章表現、「コツ・ポイント」等の解説文 | あり | 原文のまま保存・表示すると複製権侵害のリスク |
| 写真・動画 | あり | 自前保存・アプリ内表示は不可。oEmbed 埋め込みか原典リンク参照のみ |

**AI 抽出が絡む場合の論点：**

弁護士ドットコムの解説によれば、AI が材料や手順を抽出する行為自体は「情報解析」に当たるが、その前提として元のレシピ文章をサーバーに保存する行為は著作権法上の「複製」に該当する。著作権法 30 条の 4 および 47 条の 5 に情報解析のための例外規定はあるが、以下の条件が付く。

1. 解析結果として、軽微な程度を超えて**特徴までそっくりな文章を出力する場合**は、学習用の保存も文章の出力も認められない（47 条の 5 第 1 項）
2. 特徴が似た文章を出力しない場合でも、その情報解析の結果が**著作権者の利益を「不当に害する」**と評価されれば、保存自体が認められない（各条ただし書き）

加えて、アプリ内で他人のレシピ・写真を閲覧できる状態にすることは公衆送信権の問題を、AI による手順の書き換え・省略は同一性保持権の問題を生じうる。引用（32 条）は「引用が従」という要件を満たさないため成立しない。

> **結論：AI を経由すること自体は免罪符にならない。決定的なのは出力物の性質と提供形態である。**

### 3.3 最も効く分岐：私的利用か、公開サービスか

| | **個人・世帯内利用（MVP の位置づけ）** | 一般公開サービス |
|---|---|---|
| 根拠条文 | 30 条（私的使用のための複製） | 30 条の 4 / 47 条の 5 に依存。条件が厳しい |
| 手順原文の保持 | 自分用メモとして現実的にリスクは低い | 不可。要約・再表現が必須 |
| 写真の保存 | 同上 | 不可。埋め込みかリンクのみ |
| 実質的リスク | 低い | クックパッドと同じ批判を受ける |

**方針：MVP は「自分と世帯内で使う私的ツール」として設計する。** ただしデータモデルとプロンプト設計は最初から公開時の制約に耐える形にしておき、公開判断時に原文フィールドを落とすだけで移行できる構造にする。

### 3.4 設計原則（v0.3 確定版）

**「事実は保存する。表現は借りて表示する。」** これが本アプリの一行方針である。

| 情報 | 著作物性 | 扱い |
|---|---|---|
| 材料名・分量・調理時間・人数 | 薄い（事実） | **DB に構造化保存**。献立生成と買い物リストの根拠 |
| 手順 | 表現部分にあり | **AI が事実のみを抽出し独自表現で要約したものを保存**。原文は保存しない |
| 写真・動画・語り口・コツ解説 | あり | **保存しない**。公式埋め込みまたは原典リンクで都度参照 |

1. **原文を永続保存しない**（v0.3 の核心）
   取り込み時に原文を取得 → AI 要約を生成 → **原文は破棄**。DB に残るのは要約のみ。
   複製が処理過程の一時的なものに留まるため、恒久的なコピー保持が発生しない。
   結果として、私的利用か公開かの分岐に構造が依存しなくなる。
2. **要約は文体を消して機能情報のみに正規化する**
   問題になるのは表現の借用であるため、要約は**意図的に無味乾燥にする**。
   体言止め・命令形の短文へ正規化し、形容詞・副詞・話し言葉・比喩を排除する。
   詳細な生成規則は F-01-1 に定義。
3. **手順表示は「埋め込み優先、要約フォールバック」**
   埋め込み可能なソースは埋め込みプレイヤーをファーストビューに置く。
   埋め込み不可のソースは要約を表示し、原典リンクを併置する。
4. **画像は保存せず参照する**
   サムネイルは原典 URL を参照するか oEmbed を用いる。自前ストレージにコピーしない。
   プロキシキャッシュも行わない。
5. **プッシュ型 > プル型**
   クローラーによる自動巡回は行わず、ユーザーが共有シートで URL を投げ込む方式に限定する。
   これは著作権とは独立した論点である**各サービスの利用規約**（Instagram / YouTube はスクレイピングを禁止）へのリスク低減にもなる。

### 3.6 埋め込み可否マトリクス

**期待値調整：完全な埋め込みが使えるのは実質 YouTube のみ。** Instagram と Web レシピサイトは「要約 + リンクアウト」で運用することになるため、**要約の品質がプロダクトの生命線になる**。

| ソース | 埋め込み手段 | 実現性 | 実装コスト | フォールバック |
|---|---|---|---|---|
| YouTube | iframe 埋め込み | ◎ | 低。審査不要 | — |
| TikTok | oEmbed | ○ | 低。公開 API | リンクアウト |
| Instagram | oEmbed | △ | **高。Meta のアプリ審査（oEmbed Read）が必要** | ディープリンクでアプリ起動 |
| Web レシピサイト | なし | × | — | 要約 + リンクアウト |

**Instagram の判断**: MVP では oEmbed を実装せず、ディープリンク（`instagram://media?id=...` / permalink）でアプリを開く方式とする。審査コストに見合うかは利用実績を見て判断する。

### 3.7 手順表示の優先順位

```
レシピ詳細画面の手順セクション
  ↓
[1] 埋め込み可能か？
      YES → 公式プレイヤーを埋め込み表示（ファーストビュー）
             + その下に AI 要約を「調理中メモ」として折りたたみ表示
      NO  → [2] へ
  ↓
[2] AI 要約を表示
      + 「元の投稿を見る」ボタンを手順セクションの直上に常設
```

埋め込みが可能な場合でも要約を併置する理由は、調理中に動画をスクラブして目的の手順を探すのが不便なためである。要約はあくまで**動画の目次・備忘**として機能する。

### 3.5 公開サービス化する場合の追加要件

v0.3 の設計（原文非保存 + 埋め込み優先）により、**公開に向けた技術的な要件はほぼ最初から満たされる**。残るのは運用面の整備のみ。

- [x] 手順の原文を保存しない（v0.3 で設計に組み込み済み）
- [x] 画像・動画は埋め込みかリンク参照のみ。プロキシキャッシュを行わない（同上）
- [x] 原典への遷移ボタンを手順セクション直上に常設（同上）
- [ ] クリエイターからの除外申請（オプトアウト）窓口を設置
- [ ] 特定ドメイン・特定チャンネルからの取り込みを一括停止できる管理機能
- [ ] 要約の類似度チェックの閾値をより厳格に設定（F-01-1 参照）
- [ ] 弁護士によるレビュー

---

## 4. ユーザーストーリー

| ID | ストーリー | 優先度 |
|---|---|---|
| US-01 | ユーザーとして、Instagram / YouTube で見つけたレシピを共有シートからアプリに保存したい | Must |
| US-02 | ユーザーとして、保存したレシピの材料が自動で構造化されていてほしい | Must |
| US-03 | ユーザーとして、献立の生成対象ソースを選びたい（例：今週はリュウジのみ） | Must |
| US-04 | ユーザーとして、1 タップで 1 週間分の献立を生成したい | Must |
| US-05 | ユーザーとして、気に入らない 1 品だけを再抽選したい（他は維持） | Must |
| US-06 | ユーザーとして、気に入った 1 品をロックして固定したい | Must |
| US-07 | ユーザーとして、曜日ごとに献立の構成（主菜+副菜 / 一皿完結）を変えたい | Must |
| US-08 | ユーザーとして、1 週間分の材料をまとめた買い物リストが欲しい | Must |
| US-09 | ユーザーとして、買い出し中にチェックを付けながら買い物したい | Must |
| US-10 | ユーザーとして、調味料など常備品は買い物リストから除外したい | Should |
| US-11 | ユーザーとして、平日は 30 分以内で作れるレシピだけにしたい | Should |
| US-12 | ユーザーとして、同じレシピが短期間に何度も出てこないようにしたい | Should |
| US-13 | ユーザーとして、買い物リストに手動でアイテムを追加したい（牛乳、トイレットペーパー等） | Should |
| US-14 | ユーザーとして、パートナーと献立・買い物リストを共有したい | Could |

---

## 5. ドメインモデル

### 5.1 主要エンティティ

```
Source (収集元)
  └─< Recipe (レシピ)
        └─< RecipeIngredient (レシピ材料) >── Ingredient (正規化食材マスタ)

MealPlan (週間献立)
  └─< Meal (1食) ── MealTemplate (構成テンプレート)
        └─< PlanSlot (スロット) ──> Recipe

MealPlan ──1:1── ShoppingList
                    └─< ShoppingItem >── Ingredient
```

### 5.2 主要な概念定義

**dish_role（料理の役割）**
レシピが献立のどの枠に嵌るかを規定する。1 レシピに複数付与可（例：肉じゃがは `main` かつ `side`）。

- `main`: 主菜
- `side`: 副菜
- `one_dish`: 一皿完結（麺・鍋・丼・カレー）
- `soup`: 汁物
- `staple`: 主食（ご飯・パン）

**MealTemplate（献立構成テンプレート）**
1 食を構成するスロットの並び。ユーザーが定義・編集可能。

| テンプレート名 | スロット構成 | 用途 |
|---|---|---|
| 標準 | `[main, side]` | デフォルト |
| がっつり | `[main, side, side]` | 休日 |
| 主菜のみ | `[main]` | 副菜を作らない日 |
| 一皿完結 | `[one_dish]` | 麺・鍋・丼 |
| 汁物付き | `[main, side, soup]` | — |
| 外食・作らない | `[]` | 献立生成をスキップ |

### 5.3 食材の正規化（最重要ロジック）

買い物リストの品質はここで決まる。

- **表記ゆれ吸収**: 「玉ねぎ / たまねぎ / 玉葱 / タマネギ」→ `ingredient_id: onion`
  - 手順: NFKC 正規化 → ひらがな化 → エイリアス辞書照合 → 未ヒットなら LLM で既存マスタへのマッピングを提案 → 確度が低ければ新規マスタとして登録し、ユーザーに統合を提案
- **単位正規化**:
  - 重量系: `g / kg` → `g`
  - 容量系: `ml / L / cc / 大さじ(=15ml) / 小さじ(=5ml) / カップ(=200ml)` → `ml`
  - 個数系: `個 / 本 / 枚 / 束 / パック` → 合算するが単位は保持
  - 曖昧量: `適量 / 少々 / お好みで` → **合算しない**。「適量」として併記
- **売場カテゴリ**: `vegetable / meat / seafood / dairy_egg / seasoning / dry_goods / frozen / other`
  スーパーの導線順（野菜 → 肉 → 魚 → 乳製品・卵 → 調味料 → 乾物 → 冷凍）でソートする

---

## 6. 機能仕様

### F-01 レシピ収集

#### F-01-1 URL からの登録

**入力**: レシピ URL（共有シート / アプリ内ペースト）、またはスクリーンショット画像

**処理フロー**:

```
URL / 画像 受領
  ↓
[1] コンテンツ取得
  ├─ YouTube    → Data API v3 で title / description / thumbnail を取得
  │                動画のみで概要欄に材料がない場合は字幕トラックを取得
  ├─ Instagram  → oEmbed で permalink・サムネを取得
  │                キャプションが取得できない場合はユーザーに
  │                スクリーンショット添付 or テキスト貼付を促す（→ [2] へ）
  └─ Web        → HTML 取得。JSON-LD (schema.org/Recipe) があれば優先的に利用
  ↓
[2] AI による構造化抽出（Claude API / Edge Function 経由）
  ↓
[3] 材料の正規化（§5.3）
  ↓
[4] 確認画面（全項目ユーザー編集可能 + 原典リンク表示）
  ↓
[5] 保存
```

#### 抽出プロンプトの仕様

出力は以下の JSON スキーマに固定する。

```json
{
  "title": "string",
  "ingredients": [
    { "raw_text": "玉ねぎ 1/2個", "display_name": "玉ねぎ",
      "quantity": 0.5, "unit": "個" }
  ],
  "steps": [
    { "position": 1, "summary": "string" }
  ],
  "cook_time_min": 20,
  "servings": 2,
  "dish_roles": ["main"],
  "main_ingredient_category": "pork",
  "cooking_method": "fry",
  "tags": ["時短"]
}
```

**プロンプト制約（§3.4 原則 1・2 の実装）**:

*材料について*
- 原文に忠実に抽出する（事実データであり、忠実であることが正しい）
- 抽出できない項目は `null` を返す。推測で埋めない

*手順の要約について ── 意図的に無味乾燥にする*
- **体言止めまたは命令形の短文に正規化する**
- **形容詞・副詞・話し言葉・比喩・作者の語り口を排除する**
- 1 ステップあたり 60 文字以内
- 「コツ・ポイント」「おすすめです」等の解説文・作者の主観は取り込まない
- 温度・時間・分量などの数値は事実なので保持する
- 原文の語順・言い回しをなぞらず、動作と対象を再構成して記述する

```
原文：  「にんにくはね、この段階で入れちゃうと焦げるんでまだ我慢。
         豚バラは色が変わるまでガッと強火でいきます」
✗ NG： 「にんにくはまだ入れず、豚バラを強火で色が変わるまで炒める」← 語り口の骨格が残存
✓ OK： 「豚バラを強火で炒める（色が変わるまで）。にんにくは後で加える」← 事実のみ
```

*その他*
- `dish_roles` / `cooking_method` は定義済み enum のいずれかのみを返す

#### 類似度ゲート（必須）

短い手順文に対しては、プロンプトで要約を指示しても LLM はほぼ原文をそのまま返す傾向がある。47 条の 5 第 1 項が問題視するのはまさにこの「特徴までそっくりな出力」であるため、**機械的な検査を必ず挟む**。

```
AI 要約を生成
  ↓
原文との文字 3-gram 重複率を算出（ステップ単位）
  ↓
閾値（私的利用: 0.6 / 公開時: 0.4）を超過？
  ├─ YES → 「より簡潔に、語順を変えて再記述せよ」で再生成（最大 2 回）
  │          2 回超過したら、その手順は要約を破棄し
  │          「原典で確認」プレースホルダに置き換える
  └─ NO  → 採用
  ↓
原文をメモリから破棄（DB に書き込まない）
```

**原文は一切 DB に永続化しない。** 抽出処理は Edge Function 内で完結し、レスポンスとして返るのは要約済みの構造化データのみとする。

#### 抽出品質の階層

| 経路 | 精度 | 適用条件 |
|---|---|---|
| JSON-LD 直接マッピング | 高 | 構造化データあり。AI 抽出をスキップできコストも低い |
| AI 抽出（テキストあり） | 中〜高 | 概要欄・キャプション・本文が取得できる場合 |
| AI 抽出（字幕・画像 OCR） | 中 | 動画のみ / スクショのみの場合 |
| 手動入力 | — | 上記すべて失敗時 |

**エラーハンドリング**:
- 抽出失敗時は「手動入力にフォールバック」を提示し、URL・タイトル・サムネだけは保存する
- 部分抽出（材料は取れたが手順は取れない等）は `extraction_status: 'partial'` として保存し、レシピ詳細に「原典で手順を確認」バナーを出す
- 重複 URL は既存レシピを提示し、上書き / 別レシピとして登録 を選択させる

**コスト管理**: AI 抽出は 1 件あたり数円程度のコストが発生する。月間の抽出回数に上限を設け（初期値: 200 件/月）、超過時は手動入力に誘導する。JSON-LD が取れた場合は AI をスキップしてコストを抑える。

#### F-01-2 ソース管理

- Source は URL のドメイン、または YouTube チャンネル単位で自動生成される
  - 例: `リュウジのバズレシピ (YouTube)`, `instagram.com`, `delishkitchen.tv`
- ユーザーは Source ごとに **献立生成の対象に含めるか** をトグルできる
- Source には表示名・アイコン（favicon / チャンネルサムネ）を持つ
- ユーザー定義の「タグ」も擬似ソースとして生成対象フィルタに使える（例：`時短`, `ヘルシー`）

#### F-01-3 レシピライブラリ

- 一覧表示（グリッド / リスト切替）
- フィルタ: ソース、dish_role、調理時間、タグ、お気に入り
- 検索: タイトル・材料名の部分一致
- ソート: 追加日時、最終調理日、調理回数

---

### F-02 週間献立生成

#### F-02-1 生成設定

| 設定項目 | デフォルト | 説明 |
|---|---|---|
| 開始曜日 | 月曜 | — |
| 対象食事 | 夕食のみ | MVP は夕食固定、UI 上は将来拡張前提 |
| 曜日別テンプレート | 平日=標準, 土日=がっつり | 曜日ごとに MealTemplate を割当 |
| 対象ソース | 全て有効 | F-01-2 のトグル |
| 平日の調理時間上限 | 30 分 | 任意 |
| 休日の調理時間上限 | 制限なし | 任意 |
| クールダウン期間 | 14 日 | この期間内に作ったレシピは除外 |

#### F-02-2 生成アルゴリズム

制約充足 + 重み付きランダム選択。厳密最適化はせず、貪欲法 + リトライで十分。

**ステップ**:

1. **候補プールの構築**
   有効ソースのレシピから、`dish_role` がスロットに合致するものを抽出
2. **ハードフィルタ（除外）**
   - クールダウン期間内に調理済み
   - ユーザーが「二度と出さない」に設定
   - 当該週内で既に採用済み（同一週の重複禁止）
   - 調理時間が上限超過
3. **スコアリング（重み付け）**

   ```
   score = w1 * recency_score      // 最後に作ってから日数が長いほど高
         + w2 * favorite_score     // お気に入り +
         + w3 * novelty_score      // 調理回数が少ないほど高（未調理レシピを優遇）
         - w4 * variety_penalty    // 直近スロットと主要食材/調理法が被ると減点
         - w5 * reject_penalty     // 過去に再抽選で弾かれた回数に応じて減点
   ```

4. **確率的選択**
   スコアを softmax で確率化しサンプリング（決定論的に上位を取ると毎回同じ献立になるため）
5. **多様性チェック**
   週内で主要食材カテゴリ（肉・魚・野菜中心）が偏りすぎていないか検証。
   例: 鶏肉が 4 日以上 → 該当スロットを再抽選（最大 3 回リトライ）
6. **候補不足時のフォールバック**
   候補が枠数に満たない場合は制約を段階的に緩和し、緩和した旨をユーザーに通知する
   （緩和順: 調理時間上限 → クールダウン → 同一週重複）

#### F-02-3 再抽選（シャッフル）

| 粒度 | 操作 | 挙動 |
|---|---|---|
| スロット単位 | レシピカードをタップ →「別のレシピにする」 | そのスロットのみ再抽選。ロック済み・採用済みレシピは候補から除外 |
| 食事単位 | 1 日分をロングタップ →「この日を作り直す」 | その日の全スロットを再抽選（ロックされたスロットは維持） |
| 週単位 | ヘッダーの「作り直す」 | ロックされていない全スロットを再抽選 |

**ロック**: スロットに 🔒 を付けると、以降の再抽選対象から除外される。

**却下理由の記録（Should）**: 再抽選時に任意で理由を選択させ、学習に使う。
- 「気分じゃない」→ 今週のみ除外
- 「最近食べた」→ クールダウンを延長
- 「材料を揃えるのが面倒」→ `reject_penalty` を加算
- 「もう出さないで」→ 恒久除外リストへ

#### F-02-4 手動編集

- スロットを空にする
- ライブラリから任意のレシピを直接指定する
- 献立に「外食」「作らない」を設定する（買い物リストから除外される）
- 食事のテンプレートを後から変更する（スロットの増減が発生し、増えた分は自動抽選）

---

### F-03 買い物リスト

#### F-03-1 生成ロジック

```
確定した MealPlan の全 PlanSlot
  ↓ Recipe → RecipeIngredient を展開
  ↓ 人数比でスケーリング（レシピの基準人数 → 設定人数）
  ↓ ingredient_id でグルーピング
  ↓ 単位が同系統なら合算 / 異系統・曖昧量は併記
  ↓ 常備品（pantry staple）フラグが立つものを除外
  ↓ 売場カテゴリ順にソート
  ↓ ShoppingItem として保存
```

**表示例**:

```
🥬 野菜
  ☐ 玉ねぎ        3個          （麻婆豆腐、肉じゃが、味噌汁）
  ☐ にんじん      1.5本        （肉じゃが、きんぴら）
  ☐ 長ねぎ        適量 + 1本    （3品）

🥩 肉・魚
  ☐ 豚こま切れ    500g         （肉じゃが、生姜焼き）
  ☐ 鶏もも肉      2枚          （唐揚げ）

🧂 調味料  ※常備品は非表示（表示切替あり）
  ☐ オイスターソース  大さじ2   （麻婆豆腐）
```

- 各アイテムをタップすると、どのレシピで使うかの内訳を展開表示
- 数量はタップで手動編集可能（「3個」→「2個」など、家にある分を引ける）

#### F-03-2 買い出し中の操作

- チェックボックスでの消し込み。チェック済みはリスト下部へ移動 or 打ち消し線（設定）
- 手動アイテムの追加（レシピ由来でない日用品など）
- カテゴリ折りたたみ
- 「全てのチェックを外す」でリセット
- オフライン動作必須（店内は電波が弱いため、ローカル DB を正とし後で同期）

#### F-03-3 常備品（パントリー）

- ユーザーごとに「常備している食材」を登録（塩・砂糖・醤油・みりん・サラダ油・にんにくチューブ 等）
- 初期値としてよく使う調味料 20 品程度をプリセット
- 常備品はデフォルトで買い物リストから除外されるが、「常備品も表示」トグルで確認可能
- 買い物リストから「これは常備品にする」でワンタップ登録

---

## 7. データモデル (PostgreSQL / Supabase 想定)

```sql
-- ユーザー設定
create table user_settings (
  user_id uuid primary key references auth.users(id),
  household_size int not null default 2,
  week_start_day int not null default 1,        -- 1=Monday
  cooldown_days int not null default 14,
  weekday_max_cook_min int,                     -- null = 制限なし
  weekend_max_cook_min int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 収集元
create table sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  kind text not null,                           -- 'youtube' | 'instagram' | 'web' | 'manual'
  identifier text not null,                     -- channel_id / domain
  icon_url text,
  is_enabled boolean not null default true,
  created_at timestamptz default now(),
  unique (user_id, kind, identifier)
);

-- 正規化食材マスタ
create table ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),       -- null = システム共通マスタ
  canonical_name text not null,
  kana text,
  aliases text[] not null default '{}',
  category text not null,                       -- 'vegetable' | 'meat' | ...
  default_unit text,
  is_pantry_staple boolean not null default false,
  sort_order int not null default 0
);
create index on ingredients using gin (aliases);

-- レシピ
create table recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  source_id uuid references sources(id),
  title text not null,
  source_url text not null,                     -- 原典。詳細画面に必ず導線を出す
  thumbnail_url text,                           -- 原典URLを参照。自前ストレージにコピーしない

  -- 手順：AI 要約のみを保持。原文は保存しない（§3.4 原則1）
  step_summaries jsonb not null default '[]',   -- [{ position, summary, similarity_score }]
  extraction_status text not null default 'pending',
                                                -- 'pending'|'success'|'partial'|'failed'
  extracted_by text,                            -- 'jsonld'|'llm_text'|'llm_caption'|'llm_ocr'|'manual'
  extracted_at timestamptz,

  -- 埋め込み表示（§3.6）
  embed_type text,                              -- 'youtube'|'tiktok'|'instagram'|null
  embed_id text,                                -- video_id / media_id
  embed_available boolean not null default false,

  dish_roles text[] not null default '{}',      -- ['main','side',...]
  cook_time_min int,
  servings int not null default 2,
  main_ingredient_category text,                -- 多様性チェック用
  cooking_method text,                          -- 'fry'|'simmer'|'grill'|'steam'|'raw'
  tags text[] not null default '{}',
  is_favorite boolean not null default false,
  is_excluded boolean not null default false,   -- 「もう出さないで」
  cook_count int not null default 0,
  last_cooked_at date,
  reject_count int not null default 0,
  created_at timestamptz default now()
);
create index on recipes (user_id, source_id);
create index on recipes using gin (dish_roles);

-- レシピ材料
create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_id uuid references ingredients(id),
  raw_text text not null,                       -- 原文「玉ねぎ 1/2個」
  display_name text not null,
  quantity numeric,                             -- null = 適量
  unit text,                                    -- 正規化後の単位
  is_ambiguous boolean not null default false,  -- 適量・少々
  position int not null default 0
);

-- 献立テンプレート
create table meal_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),       -- null = プリセット
  name text not null,
  slots text[] not null                         -- ['main','side']
);

-- 週間献立
create table meal_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  start_date date not null,
  status text not null default 'draft',         -- 'draft' | 'confirmed' | 'archived'
  created_at timestamptz default now(),
  unique (user_id, start_date)
);

-- 1食
create table meals (
  id uuid primary key default gen_random_uuid(),
  meal_plan_id uuid not null references meal_plans(id) on delete cascade,
  date date not null,
  meal_type text not null default 'dinner',     -- 'breakfast'|'lunch'|'dinner'
  template_id uuid references meal_templates(id),
  is_skipped boolean not null default false,    -- 外食・作らない
  note text,
  unique (meal_plan_id, date, meal_type)
);

-- スロット
create table plan_slots (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references meals(id) on delete cascade,
  dish_role text not null,
  recipe_id uuid references recipes(id),        -- null = 未割当
  is_locked boolean not null default false,
  position int not null default 0
);

-- 買い物リスト
create table shopping_lists (
  id uuid primary key default gen_random_uuid(),
  meal_plan_id uuid not null references meal_plans(id) on delete cascade,
  generated_at timestamptz default now()
);

create table shopping_items (
  id uuid primary key default gen_random_uuid(),
  shopping_list_id uuid not null references shopping_lists(id) on delete cascade,
  ingredient_id uuid references ingredients(id),
  display_name text not null,
  quantity numeric,
  unit text,
  ambiguous_note text,                          -- 「適量」等の併記
  category text not null,
  is_checked boolean not null default false,
  is_manual boolean not null default false,     -- ユーザー手動追加
  source_recipe_ids uuid[] not null default '{}',
  position int not null default 0
);
```

**RLS**: 全テーブルで `user_id = auth.uid()` を基本ポリシーとする。`meals` / `plan_slots` / `shopping_items` は親テーブル経由で判定。

---

## 8. 画面仕様

| 画面 | 主要要素 |
|---|---|
| **ホーム（今週の献立）** | 曜日別カード縦スクロール。各カードにスロット別レシピ、🔒 トグル、再抽選ボタン。ヘッダーに「週全体を作り直す」「買い物リストへ」 |
| **献立生成設定** | 期間、曜日別テンプレート、対象ソース、人数、調理時間上限 |
| **レシピ詳細** | タイトル、材料一覧、調理時間、お気に入り、タグ編集。手順セクションは §3.7 の優先順位に従い、埋め込み可能なら公式プレイヤーをファーストビューに、不可なら AI 要約 + 「元の投稿を見る」ボタンを表示 |
| **レシピライブラリ** | 検索・フィルタ・ソート付き一覧、FAB から新規追加 |
| **レシピ追加** | URL 貼付 / 共有シートからの遷移 / 手動フォーム。取得結果の確認・編集画面 |
| **買い物リスト** | カテゴリ別セクション、チェックボックス、内訳展開、手動追加 FAB、常備品表示トグル |
| **設定** | ソース管理、常備品管理、食材マスタ統合、世帯人数、テンプレート管理 |

**共有シート（Share Extension）**: 他アプリから URL を受け取り、バックグラウンドで解析キューに投入。アプリ本体を開かずに完了できることが重要。

---

## 9. 技術スタック（案）

| レイヤ | 技術 | 理由 |
|---|---|---|
| モバイル | Expo (React Native) | Saving Calendar と同構成で知見流用可 |
| 状態管理 | TanStack Query + Zustand | サーバー状態とローカル UI 状態の分離 |
| ローカル DB | expo-sqlite (or WatermelonDB) | 買い物リストのオフライン動作が必須要件 |
| BaaS | Supabase (Postgres / Auth / Edge Functions) | RLS で共有機能まで見通せる |
| URL 解析 | Supabase Edge Functions (Deno) | HTML 取得・JSON-LD パース。CORS 回避のためサーバー側で実行 |
| LLM 構造化 | Claude API (Edge Functions 経由) | 材料抽出・食材名の正規化マッピング |
| 共有シート | expo-share-extension | Config Plugin が必要。Expo Go では動作しないため Dev Client 必須 |

**注意点**: 共有シートは Expo Go で検証できないため、開発初期から EAS Build による Dev Client 前提で環境を組むこと。

---

## 10. 非機能要件

| 項目 | 要件 |
|---|---|
| 献立生成レスポンス | 1 秒以内（クライアント側で完結させる。レシピ数 500 件程度を想定） |
| URL 解析 | 10 秒以内。超過時はバックグラウンド処理へ回し完了通知 |
| オフライン | 献立閲覧・買い物リストのチェックはオフラインで完全動作。復帰時に Last-Write-Wins で同期 |
| データ量 | 1 ユーザーあたりレシピ 1,000 件を上限想定 |
| 対応 OS | iOS 16+ / Android 10+（MVP は iOS 優先） |
| 言語 | 日本語のみ（i18n の構造だけ用意） |

---

## 11. マイルストーン

### M1: レシピライブラリ + AI 抽出（3〜4週）
手動入力、URL からの JSON-LD パース、**AI 構造化抽出パイプライン**、レシピ一覧・詳細、食材正規化の基礎。
抽出精度がプロダクト全体の体験を規定するため、ここに最も時間を割く。

### M2: 献立生成（2週）
生成アルゴリズム、週表示、再抽選・ロック、テンプレート

### M3: 買い物リスト（1〜2週）
食材集約、カテゴリ別表示、チェック管理、常備品

### M4: 収集体験の強化（2週）
共有シート（Share Extension）、YouTube Data API 連携、字幕・スクショ OCR からの抽出

### M5: 仕上げ（1週）
オフライン同期、設定画面、オンボーディング

---

## 12. 未決事項（要意思決定）

| # | 論点 | 選択肢 | 推奨 |
|---|---|---|---|
| 1 | ~~公開サービス化するか、私的ツールに留めるか~~ | — | **解決済み**。v0.3 の設計（原文非保存 + 埋め込み優先）により構造が公開可否に依存しなくなった。判断を後倒しできる |
| 1-b | 類似度ゲートの閾値 | 3-gram 重複率 0.6 / 0.5 / 0.4 | 私的利用は 0.6、公開時は 0.4。実データで要約が破棄される率を計測して調整する |
| 1-c | Instagram oEmbed の審査を通すか | (a) 通さずディープリンク (b) 審査を通す | (a) で開始。Instagram 由来レシピの割合が 3 割を超えたら (b) を再検討 |
| 2 | 食材マスタを全ユーザー共通にするか | (a) ユーザーごと (b) 共通マスタ + ユーザー拡張 | (b)。正規化精度が上がるが、初期は (a) で始めても良い |
| 3 | LLM 呼び出しのコスト負担 | (a) 自己負担（無料提供） (b) 従量制限 | (a) で開始し、レシピ登録回数に月次上限を設ける |
| 4 | 副菜レシピの供給不足への対処 | (a) 諦めて主菜のみ (b) 副菜プリセットを同梱 | (b)。バズレシピ系は主菜偏重なので、汎用副菜 50 品程度のプリセットが実質的に必須 |
| 5 | パートナー共有の実装時期 | MVP に含める / v1.1 | v1.1。ただし RLS 設計は共有前提で切っておく |
| 6 | 朝食・昼食への拡張 | — | データモデルは対応済み。UI は夕食のみで開始 |

---

## 13. リスク

| リスク | 影響 | 対策 |
|---|---|---|
| レシピサイトの構造変更でパース失敗 | 高 | JSON-LD を主経路にし、LLM フォールバックを常に用意。パース失敗率を計測 |
| Instagram からのキャプション取得が不可 | 中 | スクリーンショット添付 → OCR + AI 抽出の経路を MVP から用意する |
| AI 抽出コストがユーザー数に比例して膨らむ | 中 | JSON-LD 優先でスキップ、月次上限、抽出結果のキャッシュ（同一 URL は再抽出しない） |
| AI が手順の原文をほぼそのまま出力してしまう | 高 | 47 条の 5 第 1 項に抵触する。F-01-1 の類似度ゲートを必須実装。**要約は味気ないほど安全**という前提を開発チームで共有する |
| Instagram oEmbed の審査が通らない / 通す工数が見合わない | 中 | MVP では実装せずディープリンクで代替。要約の品質でカバーする |
| 埋め込みプレイヤーが調理中の UX を損なう（動画のスクラブが面倒） | 中 | 埋め込みと要約を必ず併置し、要約を動画の目次として機能させる |
| 食材正規化の精度不足で買い物リストが破綻 | 高 | プロダクトの生命線。ユーザーによる統合操作を簡単にし、修正が学習に反映される導線を作る |
| 副菜レシピが集まらず献立が生成できない | 中 | 未決事項 #4 のプリセット同梱、および候補不足時の制約緩和フォールバック |
| ToS / 著作権上の指摘 | 中 | 私的利用範囲に限定。クローラー巡回を行わず共有シート経由に限る。公開時は §3.5 のゲートを必須通過 |
| 発信者コミュニティからの反発（レピュテーション） | 高 | クックパッドの事例が示す通り、法的評価とは別軸のリスク。原典への導線をファーストビューに置き、「元投稿を見る」の遷移率を計測して機能の健全性指標とする |
