# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクトの現状

**週間献立プランナー**（レシピ収集 → 献立自動生成 → 買い物リスト）。現時点では**コードは存在せず、`docs/` の設計ドキュメントのみ**がある計画段階。実装を始める際の一次情報源は以下：

- `docs/Weekly Menu Planner Spec.md` (v0.3) — 機能仕様・ドメインモデル・データモデル（PostgreSQL DDL 含む）・著作権制約
- `docs/architecture.md` (v0.1) — システム構成・取り込みフロー・モノレポ構成・オフライン戦略
- `docs/techstack_cost_analysis.md` (v0.1) — 技術選定の根拠（すべて決定済み）

これらの間で矛盾があれば `architecture.md` / `techstack_cost_analysis.md` の決定が優先。特に **Spec §9「技術スタック（案）」の Expo / React Native は古い案であり、確定スタックは PWA（Vite + React Router + Dexie.js）**。混同しないこと。

## 確定した技術スタックと構成

pnpm workspaces のモノレポ。月額ランニングコスト 0 円が設計上の絶対制約（→ ネイティブでなく PWA、有料でなく Gemini 無料枠）。

```
packages/core/        # 純粋 TypeScript。依存ゼロ。ブラウザと Deno の両方から import される
apps/web/             # Vite + React Router（PWA）。献立生成・買い物リスト・全 UI をここで実行
supabase/functions/   # Deno。レシピ取り込み（抽出）パイプラインのみ
```

- フロント配信: Cloudflare Pages / ローカル DB: Dexie.js (IndexedDB) / BaaS: Supabase Free (Postgres + Auth + Edge Functions + Realtime)
- LLM: Gemini Flash 無料枠を主、Claude Haiku 4.5 を品質フォールバック。`ExtractionProvider` インタフェースでプロバイダを差し替え可能にする（Edge Function 内）
- 取り込み導線: iOS ショートカット → Edge Function への POST（Share Extension の代替。Apple 年会費を回避するため）

## 設計上の核心制約（実装前に必ず理解すること）

### 1. `packages/core` は Deno とブラウザの両方から読まれる（唯一の技術的摩擦点）
- **npm 依存をゼロにする**
- **Node 組み込みモジュール（`fs` / `path` / `crypto` 等）を使わない**
- **相対 import は拡張子付きで書く**（`./foo.ts`）。Deno は拡張子を省略できない

役割分担: `generation/`（献立生成）と `shopping/`（買い物リスト集約）はブラウザで実行。`normalize/`（食材正規化）と `similarity/`（3-gram 類似度）は Deno で実行。

### 2. 「事実は保存する。表現は借りて表示する。」（著作権制約 — Spec §3.4）
- **レシピの原文を DB に永続保存しない。** 取り込み時に原文取得 → AI 要約生成 → **原文をメモリから破棄**。DB に残るのは無味乾燥に正規化した要約のみ
- **類似度ゲートは必須実装。** AI 要約と原文の文字 3-gram 重複率を算出し、閾値（私的利用 0.6 / 公開時 0.4）超過なら再生成（最大 2 回）、それでも駄目なら要約を破棄して原典リンクに置換
- 画像・動画は保存せず、YouTube iframe 埋め込みか原典リンクで参照。プロキシキャッシュもしない
- この設計により、私的利用／公開サービスの分岐に構造が依存しなくなっている

### 3. 献立生成と買い物リストはクライアント側で完結（サーバー・LLM 不使用）
- Dexie から全レシピをロードし、ハードフィルタ → スコアリング → softmax サンプリング → 多様性チェックをすべてブラウザ内で実行。非機能要件「生成 1 秒以内」を素直に満たす
- LLM が必要なのは**レシピ取り込みの瞬間だけ**で、1 レシピにつき生涯 1 回（結果を DB 保存するため）。これがコスト構造を決定づけている
- JSON-LD (schema.org/Recipe) が取れる場合は LLM をスキップ（コスト 0）

### 4. オフラインファースト（買い物リストは店内で電波が弱くても完全動作）
- **読み取りは常に Dexie から**（UI はネットワークを待たない）
- **書き込みは Dexie に書いた上で `outbox` テーブルに積む**。`navigator.onLine` / `online` イベントを契機にフラッシュ、指数バックオフでリトライ
- 競合解決は `updated_at` による Last-Write-Wins（世帯内 2 人利用のため実質競合しない）

### 5. 取り込みは非同期（Edge Function は即 202 を返す）
- 抽出は 5〜15 秒かかるためショートカットを待たせない。Edge Function は即 202 を返し `EdgeRuntime.waitUntil()` で処理継続。結果は Realtime で PWA に通知
- フォールバック: `import_jobs` が 10 分以上 `pending` なら再実行する `pg_cron` を置く

## セキュリティ（実装時の必須事項）
- **Gemini / YouTube API キーは Edge Function の環境変数にのみ格納。PWA バンドルに絶対含めない**（クライアント JS は誰でも読める）
- 全テーブルで RLS `user_id = auth.uid()`。子テーブル（`meals` / `plan_slots` / `shopping_items`）は親経由で判定
- ショートカット用 ingest トークンは**ハッシュ化して保存**（生トークンは保存しない）。レート制限（1 トークン 60 件/時）とリボーク機能を必須実装
- 抽出対象 URL は SSRF 対策として内部アドレス（`localhost` / `169.254.*` / プライベート IP）への fetch を拒否

## 開発コマンド

pnpm workspaces（`packages/*` / `apps/*`）。pnpm は corepack 経由（`corepack enable pnpm`）。

```bash
pnpm install                       # 全ワークスペースの依存を導入
pnpm -r test                       # 全パッケージのテスト（vitest）
pnpm -r typecheck                  # 全パッケージの型検査（tsc --noEmit）

# packages/core 単体
pnpm --filter @recipe-planner/core test
pnpm --filter @recipe-planner/core test:watch
pnpm --filter @recipe-planner/core exec vitest run src/generation/generate.test.ts  # 単一ファイル

# apps/web (PWA)
pnpm --filter @recipe-planner/web dev       # 開発サーバ
pnpm --filter @recipe-planner/web build     # 本番ビルド（vite build、PWA SW 生成）
pnpm --filter @recipe-planner/web typecheck
```

`packages/core` はビルド不要（`.ts` ソースを Vite / Deno が直接消費する）。`exports` は `.ts` を指し、Vite 側は `optimizeDeps.exclude` で prebundle を回避している。`supabase/functions` は未スキャフォールド。

### apps/web の構成
- Vite + React 19 + React Router v7 + vite-plugin-pwa。UI は `src/routes/`（Home=献立生成 / Library / RecipeDetail=`/recipe/:id` / Add=手動レシピ登録 / Shopping / Settings）、共通シェルは `src/components/Layout.tsx`（下部タブ）
- レシピ詳細(`/recipe/:id`): 材料・原典リンク・お気に入り/タグ編集・除外(「もう出さないで」)。手順は原典が YouTube なら iframe 埋め込み(`lib/youtube.ts`)、不可なら原典リンク(§3.6/§3.7)。編集は `lib/recipeEdit.ts`
- 手動レシピ登録は `src/lib/recipeForm.ts`（保存）＋ `src/lib/ingredients.ts`（`matchMaster`: core の正規化キーで既存マスタ照合、未ヒットは新規マスタ作成）
- 注意: `recipes` の Dexie インデックスは `id, source_id, *dish_roles, last_cooked_at` のみ。`title` 等の非インデックス列で `orderBy` するとエラーになるため、メモリ内ソートする
- `src/db/` — Dexie。**行は snake_case で保持**（Supabase と 1:1 同期のため）、`mappers.ts` で core の camelCase ドメイン型へ変換。IndexedDB は boolean をキーにできないため `is_checked` 等はインデックスせずメモリでフィルタ
- `src/lib/planning.ts` — core (`generateMealPlan` / `aggregateShoppingList`) と Dexie を繋ぐ層。`generateWeek()` が献立を生成し Dexie に保存、`buildShoppingItems()` が買い物リストを集約。**週の「作り直す」は常に `generateWeek`**（現在の曜日テンプレで構造から再生成し、既存プランのロック済みスロットを slotId 一致で引き継ぐ）。スロット/食事の再抽選(US-05): `reshuffleSlot`(必ず別レシピ・代替無ければ現状維持) / `reshuffleMeal`（ロック維持）/ `toggleSlotLock`(US-06)。共通ロジックは `reshuffleSlots`（対象外・ロック済みのレシピを除外して再抽選）。生成・再抽選とも `loadEligibleRecipes()` 経由でレシピを読み、**無効ソース(`is_enabled=false`)のレシピを除外**(US-03)
- 曜日ごとの献立構成(US-07): `lib/mealTemplates.ts`（プリセット6種＋月起点の週割り当て）＋ `lib/settings.ts`（Dexie の `settings` KVストア。schema **v2** で追加）。設定画面で曜日別にテンプレ選択。`eat_out`(空スロット) の日は `is_skipped` の Meal になり生成対象外
- `src/db/seed.ts` — 開発用サンプルデータ（抽出パイプライン未実装のため。設定画面から投入）
- **オフライン同期（outbox → Supabase）は未実装**。現状 Dexie はローカルのみ

### packages/core の構成
- `src/types/` — 共有ドメイン型（DB は snake_case、ドメイン層は camelCase。変換は永続化層の責務）
- `src/generation/` — 献立生成。`generateMealPlan()` が入口。`rng.ts`(seeded RNG + softmax) / `scoring.ts`(F-02-2 の重み付け) / `generate.ts`(候補構築→フィルタ→サンプリング→多様性再抽選→制約緩和)。**乱数は注入可能**（テストは `mulberry32` で決定論化）
- `src/shopping/` — 買い物リスト集約。`aggregateShoppingList()` が入口。`units.ts`(単位分類・換算 §5.3) / `aggregate.ts`(展開→スケール→グルーピング→合算→常備品除外→売場順ソート)
- `src/normalize/` — 食材名の正規化。`normalizeIngredientName()`(NFKC→ひらがな化→空白除去→小文字化)。手動入力と抽出パイプラインが共有する照合キー生成
- `src/similarity/` — 文字 3-gram 類似度（§3.4）。`overlapRatio`/`checkSimilarity`、閾値 `SIMILARITY_THRESHOLDS`(私的0.6/公開0.4)。要約が原文表現をなぞっていないかの機械検査
- `src/extraction/` — レシピ抽出の**共有型・純粋ロジック**（Deno の Edge Function から利用）。`types.ts`(`ExtractionProvider` 抽象/結果型) / `jsonld.ts`(schema.org/Recipe 直接マッピング=Tier0・LLM不要) / `gate.ts`(`applySimilarityGate`: 超過なら再生成最大2回→破棄) / `html.ts`(JSON-LD ブロック抽出・本文テキスト化、DOM非依存) / `url.ts`(`validateExternalUrl`: SSRF 判定) / `prompt.ts`(抽出プロンプト・出力スキーマ)
- `src/testing.ts` — テスト専用ファクトリ（`index.ts` からは公開しない）
- 注意: core の tsconfig は `lib: ["ES2022","WebWorker"]`。`URL`/`fetch` 等の Web 標準グローバルの型のみ入れ、`document`/`window` は含めない（DOM フリー規律を維持）

### supabase/functions（Deno・抽出パイプライン）
- `_shared/fetch.ts`(SSRF再検証付き安全fetch: リダイレクト手動追跡・タイムアウト・サイズ上限) / `_shared/pipeline.ts`(取得→JSON-LD高速経路 or LLM抽出→類似度ゲート→原文破棄) / `_shared/providers/`(`gemini.ts` 実装・`mock.ts` キー無しローカル検証用) / `_shared/provider-select.ts`(`GEMINI_API_KEY` があれば Gemini、無ければ Mock) / `ingest/index.ts`(POST /ingest: 即202 + `EdgeRuntime.waitUntil()`)
- core は `deno.json` の import map で `@recipe-planner/core/extraction` 等を相対 `.ts` にエイリアス
- **未接続**: Supabase プロジェクト・DB(import_jobs/recipes 挿入)・ingest トークン照合・レート制限・Realtime 通知は `ingest/index.ts` に TODO として明示。Gemini キー投入で実プロバイダに切替
- **deno 未インストールのため Deno 側は型チェック未実施**。純粋ロジック(SSRF/JSON-LD/ゲート/HTML)は core に置き vitest でカバー済み

## 実装の優先順位

M1 の AI 抽出パイプラインと食材正規化に最も時間を割く。**材料の取りこぼしは買い物リストの破綻に直結し、プロダクト全体の価値を決める**（Spec §5.3・Architecture §8）。PWA 化とショートカットは最後でよく、合計 4 日程度で済む。
