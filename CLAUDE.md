# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクトの現状

**週間献立プランナー**（レシピ収集 → 献立自動生成 → 買い物リスト）。M1〜M3 相当（取り込みパイプライン・献立生成・買い物リスト）は実装済みで、`docs/` の設計ドキュメントが引き続き一次情報源：

- `docs/Weekly Menu Planner Spec.md` (v0.3) — 機能仕様・ドメインモデル・データモデル（PostgreSQL DDL 含む）・著作権制約
- `docs/architecture.md` (v0.1) — システム構成・取り込みフロー・モノレポ構成・オフライン戦略
- `docs/techstack_cost_analysis.md` (v0.1) — 技術選定の根拠（すべて決定済み）
- `docs/ios-shortcut.md` — 取り込み導線（共有シート → Edge Function）のセットアップ手順とトラブルシュート

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

CI は `.github/workflows/ci.yml`（PR と main への push で `pnpm -r typecheck` / `pnpm -r test` / `vite build`、および Edge Function の `deno check`）。

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

`packages/core` はビルド不要（`.ts` ソースを Vite / Deno が直接消費する）。`exports` は `.ts` を指し、Vite 側は `optimizeDeps.exclude` で prebundle を回避している。

### 配信（Cloudflare Workers Static Assets・GitHub 連携=Workers Builds）
- ルートの `wrangler.jsonc` が設定（`assets.directory=apps/web/dist`、`not_found_handling=single-page-application` で SPA deep link を index.html にフォールバック）
- **Build command**: `pnpm --filter @recipe-planner/web build`
- **Deploy command**: `npx wrangler deploy`（`wrangler.jsonc` を読む）
- **Path/Root**: `/`（モノレポのため。core を workspace 解決する）
- **環境変数（ビルド時に焼き込み）**: `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` / `NODE_VERSION=22`（supabase-js の realtime が Node 22+ のネイティブ WebSocket を要求する。20 だとテスト実行時に落ちる）
- SPA fallback は `not_found_handling` が担う。**`_redirects` は置かないこと**（Workers Static Assets も読み込み、`/* /index.html 200` は「無限ループ」判定でデプロイが失敗する code:100324）

### apps/web の構成
- Vite + React 19 + React Router v7 + vite-plugin-pwa。UI は `src/routes/`（Home=献立生成 / Library / RecipeDetail=`/recipe/:id` / Add=手動レシピ登録 / Shopping / Settings）、共通シェルは `src/components/Layout.tsx`（下部タブ）
- レシピ詳細(`/recipe/:id`): 材料・原典リンク・タイトル/お気に入り/タグ編集・除外(「もう出さないで」)・削除(2段階確認)。手順は原典が YouTube なら iframe 埋め込み(`lib/youtube.ts`)、不可なら原典リンク(§3.6/§3.7)。編集/削除は `lib/recipeEdit.ts`。**`updateRecipe`/`deleteRecipe` は Supabase 設定時に Supabase も更新/削除**（Dexie だけ変更すると次回プルで巻き戻る/復活するため）
- 手動レシピ登録は `src/lib/recipeForm.ts`（保存）＋ `src/lib/ingredients.ts`（core の `createIngredientIndex`/`matchIngredientMaster` を Dexie 行に当てる薄いアダプタ。未ヒットは新規マスタ作成、売場の初期値は `classifyIngredient`）
- `src/lib/ingestTokens.ts` / `src/lib/importJobs.ts` / `components/IngestCard.tsx` — ショートカット用トークンの発行・失効と、取り込みジョブの状況表示（設定画面）。**生トークンは発行時に一度だけ表示**し DB にはハッシュのみ。`isStalled`（10 分以上 pending）は純粋関数でテスト有り
- `src/lib/recipeSearch.ts` — ライブラリの検索・絞り込み・並べ替え(F-01-3)。`filterRecipes` は純粋関数（テスト有り）。検索は**タイトル・タグ・材料名**が対象で、照合は `normalizeIngredientName` を通すのでカナ/空白の揺れを吸収する。絞り込みは役割・ソース・調理時間・お気に入り（**調理時間が不明なレシピは落とさない**）
- `src/lib/ingredientMerge.ts` — 食材マスタの統合(§5.3)。`mergeIngredients` が材料行・買い物リスト項目の参照を付け替え、消える側の名前を `aliases` に引き継いで削除する（送信キュー経由で Supabase にも反映。削除は最後に送る）。候補提示 `suggestMerges` は**わざと保守的**で、正規化キー一致か「同カテゴリで名前を丸ごと含む」場合のみ。3-gram 類似度は「牛こま切れ肉/豚こま切れ肉」を似ていると誤判定するため使わない
- `src/lib/relink.ts` — `ingredient_id` が null の材料をマスタに再照合する保守処理（設定画面から実行）。S1 以前に取り込んだレシピを救済する。Dexie と Supabase の両方を更新
- 注意: `recipes` の Dexie インデックスは `id, source_id, *dish_roles, last_cooked_at` のみ。`title` 等の非インデックス列で `orderBy` するとエラーになるため、メモリ内ソートする
- `src/db/` — Dexie。**行は snake_case で保持**（Supabase と 1:1 同期のため）、`mappers.ts` で core の camelCase ドメイン型へ変換。IndexedDB は boolean をキーにできないため `is_checked` 等はインデックスせずメモリでフィルタ
- `src/lib/planning.ts` — core (`generateMealPlan` / `aggregateShoppingList`) と Dexie を繋ぐ層。`generateWeek()` が献立を生成し Dexie に保存、`buildShoppingItems()` が買い物リストを集約。**週の「作り直す」は常に `generateWeek`**（現在の曜日テンプレで構造から再生成し、既存プランのロック済みスロットを slotId 一致で引き継ぐ）。スロット/食事の再抽選(US-05): `reshuffleSlot`(必ず別レシピ・代替無ければ現状維持) / `reshuffleMeal`（ロック維持）/ `toggleSlotLock`(US-06)。共通ロジックは `reshuffleSlots`（対象外・ロック済みのレシピを除外して再抽選）。生成・再抽選とも `loadEligibleRecipes()` 経由でレシピを読み、**無効ソース(`is_enabled=false`)のレシピを除外**(US-03)
- `src/lib/cooking.ts` — 調理の記録。献立スロットの `cooked_at`（Dexie のみ・非インデックス列）で「作った」を持ち、レシピの `cook_count`/`last_cooked_at` を `updateRecipe` 経由で更新（Supabase にも反映）。**これが無いとクールダウンと novelty が初期値のまま効かない**(US-12)。取り消しは `deriveLastCookedAt`（全プランの記録から最新日を導出する純粋関数）で戻すため、押し間違いを繰り返しても値がずれない。調理済みスロットは再抽選・作り直しの対象外（記録が別レシピを指さないように）
- `src/lib/shopping.ts` — 買い物リストの永続化(US-09)。`syncShoppingList()` が集約結果を `shoppingItems` に保存し、`reconcileShoppingItems()`（純粋関数・テスト有り）が**既存項目の id とチェック状態を引き継ぐ**（同一性キーは `ingredient_id ?? name:正規化表示名`）。献立から消えた項目は削除、`is_manual` の項目は常に残す。**常備品も含めて保存し表示側でフィルタする**（トグルで行を作り直すとチェックが消えるため）。`setItemChecked` / `clearChecked` / `pantryIngredientIds`。手動追加(US-13)は `addManualItem`（売場は `classifyIngredient` で推定・`is_manual` を立てるので作り直しでも残る）/ `removeShoppingItem`。**献立が無い週でも追加できる**（先に買うものだけ登録しておける）
- 曜日ごとの献立構成(US-07): `lib/mealTemplates.ts`（プリセット6種＋月起点の週割り当て）＋ `lib/settings.ts`（Dexie の `settings` KVストア。schema **v2** で追加）。設定画面で曜日別にテンプレ選択。`eat_out`(空スロット) の日は `is_skipped` の Meal になり生成対象外
- 生成設定(F-02-1): `lib/settings.ts` の `PlanningSettings`（世帯人数・クールダウン日数・平日/休日の調理時間上限）。既定は仕様表どおり **平日 30 分・休日制限なし・クールダウン 14 日**。保存・読み込みは必ず `normalizePlanningSettings`（純粋関数・テスト有り）を通し、壊れた値が生成ロジックに流れないようにする。`generateWeek`/再抽選が core の `settings` に写して渡し、買い物リストの人数スケーリングにも使う
- 常備品(US-10): 設定画面の食材マスタ一覧でトグル（`setPantryStaple`）。買い物リストは常備品も保存しつつ既定で非表示にする
- `src/db/seed.ts` — 開発用サンプルデータ（抽出パイプライン未実装のため。設定画面から投入）
- **Supabase 連携（レシピライブラリのみ）**: `lib/supabase.ts`(クライアント・`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`) / `lib/auth.tsx`(メール＋パスワード認証コンテキスト) / `AppGate.tsx`(未認証はログイン画面、認証時に同期起動) / `lib/sync.ts`(`pullLibrary`: recipes/sources/ingredients を Supabase→Dexie に一方向プル、`subscribeImports`: import_jobs の Realtime で取り込み完了時に再プル)。**UI は常に Dexie から読む**（Supabase は同期元）。env 未設定ならログインを出さずローカル Dexie のみで動作
- **書き戻し（Dexie → Supabase）は送信キュー経由**（`lib/outbox.ts` / `lib/outboxSync.ts`、architecture §5.1）。レシピ編集/削除・ソースの有効無効・常備品フラグ・手動レシピ登録・食材の再照合はすべて **Dexie に書く → `outbox` に積む → オンライン時に流す**。オフラインでも操作は成功する
  - 送るのは差分でなく**現在の行**（state-based）。同じ行の連続編集は `coalesceOutbox` で 1 件に畳む。1 件失敗したらそこで止め、指数バックオフで再試行（起点は 起動時 / `online` イベント / バックオフ）
  - `lib/ids.ts` の `isUuid` と `isSupabaseConfigured` で「Supabase に存在しえない行」「ローカル専用モード」は積まない。`recipes` の `source_id` が UUID でない場合は送信時に null に落とす（`src-manual` はサーバに無いため）
  - 手動レシピのソースは `ensureManualSource` が Supabase の `(manual, manual)` 行を正とし、その UUID を Dexie の ID にも使う。オフライン時はローカル専用ソースにフォールバックする
  - 設定画面に未送信件数と「今すぐ送信」を表示する
- **献立・買い物リストの端末間同期**(US-14) は `lib/planSync.ts`。サーバーが中身を読む場面が無いため正規化テーブルには展開せず、**クライアントの入れ子ドキュメントを 1 週 1 行の jsonb に入れる**（`meal_plans.doc` / `shopping_lists.doc`）。既存の `meals`/`plan_slots`/`shopping_items` テーブルは未使用のまま残している
  - 献立は**ドキュメント単位の LWW**、買い物リストは**項目単位のマージ**（二人が同じ店で別々の項目にチェックしても消えないように）。どの項目が存在するかは新しい方のドキュメントに従う
  - LWW の時計は doc 内の `updated_at`（Supabase の `updated_at` はトリガが上書きするため使わない）
  - 送信は outbox の `planDocs` テーブル経由（`plan-YYYY-MM-DD` をキーにするので `isUuid` ガードの例外）。受信は起動時の `pullPlans()` と `meal_plans`/`shopping_lists` の Realtime

### packages/core の構成
- `src/types/` — 共有ドメイン型（DB は snake_case、ドメイン層は camelCase。変換は永続化層の責務）
- `src/generation/` — 献立生成。`generateMealPlan()` が入口。`rng.ts`(seeded RNG + softmax) / `scoring.ts`(F-02-2 の重み付け) / `generate.ts`(候補構築→フィルタ→サンプリング→多様性再抽選→制約緩和)。**同一食事内の重複だけは緩和対象外**（`SlotRequest.mealId` でグループ化。同じ日の主菜と副菜が同じ料理になるのは献立として成立しないため、埋まらない枠は空のままにする）。**乱数は注入可能**（テストは `mulberry32` で決定論化）
- `src/shopping/` — 買い物リスト集約。`aggregateShoppingList()` が入口。`units.ts`(単位分類・換算 §5.3) / `aggregate.ts`(展開→スケール→グルーピング→合算→常備品除外→売場順ソート)
- `src/normalize/` — 食材名の正規化。`name.ts`(`normalizeIngredientName()`: NFKC→ひらがな化→空白除去→小文字化) / `match.ts`(`createIngredientIndex`/`matchIngredientMaster`: 正規化キー＋`aliases` でマスタ照合。行型を持ち込まないため名前取り出し関数 `keysOf` を受ける) / `category.ts`(`classifyIngredient`: 辞書の**最長一致**で売場カテゴリ＋常備品フラグを推定。「冷凍◯◯」は先頭一致で frozen)。手動入力と抽出パイプラインが共有する
- `src/tokens/` — ingest トークンの生成 (`generateIngestToken`) と SHA-256 ハッシュ (`hashIngestToken`)。**発行する PWA と照合する Edge Function が同じ実装を使うことが必須**なのでここに置く
- `src/similarity/` — 文字 3-gram 類似度（§3.4）。`overlapRatio`/`checkSimilarity`、閾値 `SIMILARITY_THRESHOLDS`(私的0.6/公開0.4)。要約が原文表現をなぞっていないかの機械検査
- `src/extraction/` — レシピ抽出の**共有型・純粋ロジック**（Deno の Edge Function から利用）。`types.ts`(`ExtractionProvider` 抽象/結果型) / `jsonld.ts`(schema.org/Recipe 直接マッピング=Tier0・LLM不要) / `gate.ts`(`applySimilarityGate`: 超過なら再生成最大2回→破棄) / `html.ts`(JSON-LD ブロック抽出・本文テキスト化、DOM非依存) / `youtube.ts`(watch HTML から概要欄`shortDescription`/タイトル抽出。概要欄は`<script>`内で htmlToText では落ちるため専用) / `url.ts`(`validateExternalUrl`: SSRF 判定) / `source.ts`(`deriveSource`: 原典 URL＋ヒントから収集元を同定。YouTube はチャンネル ID、Web はホスト名が `identifier`) / `prompt.ts`(**Gemini responseSchema 互換**の出力スキーマ＋プロンプト)
- `src/testing.ts` — テスト専用ファクトリ（`index.ts` からは公開しない）
- 注意: core の tsconfig は `lib: ["ES2022","WebWorker"]`。`URL`/`fetch` 等の Web 標準グローバルの型のみ入れ、`document`/`window` は含めない（DOM フリー規律を維持）

### supabase/functions（Deno・抽出パイプライン）
- `_shared/fetch.ts`(SSRF再検証付き安全fetch: リダイレクト手動追跡・タイムアウト・サイズ上限) / `_shared/pipeline.ts`(取得→JSON-LD高速経路 or LLM抽出→類似度ゲート→原文破棄) / `_shared/providers/`(`gemini.ts` 実装・`mock.ts` キー無しローカル検証用) / `_shared/provider-select.ts`(`GEMINI_API_KEY` があれば Gemini、無ければ Mock) / `ingest/index.ts`(POST /ingest: 即202 + `EdgeRuntime.waitUntil()`)
- core は `deno.json` の import map で `@recipe-planner/core/extraction` 等を相対 `.ts` にエイリアス
- `_shared/db.ts`(サービスロールで DB 操作。トークン照合(SHA-256 ハッシュ)・レート制限・`import_jobs`・`recipes`/`recipe_ingredients` 挿入)。挿入時に **`ensureSource`(収集元を同定/作成 → `source_id`)** と **`resolveIngredientIds`(core の索引でマスタ照合、未登録は `classifyIngredient` でカテゴリ推定して作成 → `ingredient_id`)** を通す。ここが埋まらないと買い物リストが全部「その他」に落ちる
- ingest トークンは **PWA の設定画面から発行**（`lib/ingestTokens.ts`。生成・ハッシュは core の `tokens` を Edge と共有するので照合がずれない）。10 分以上 `pending` のジョブは `fail_stalled_import_jobs()` を pg_cron が 5 分ごとに呼んで failed に落とす（PWA 側も 10 分経過を「停止」と表示する）
- ローカルに deno が無くても CI が `deno check` する。純粋ロジック(SSRF/JSON-LD/ゲート/HTML)は core に置き vitest でカバー済み

## 実装の優先順位

M1 の AI 抽出パイプラインと食材正規化に最も時間を割く。**材料の取りこぼしは買い物リストの破綻に直結し、プロダクト全体の価値を決める**（Spec §5.3・Architecture §8）。PWA 化とショートカットは最後でよく、合計 4 日程度で済む。
