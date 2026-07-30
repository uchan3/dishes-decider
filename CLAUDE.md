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

## 開発コマンド（スキャフォールド後に追記すること）

現時点で `package.json` は未作成。モノレポ初期化後、実際のスクリプトに合わせてここを更新する。想定される流れ:

```bash
pnpm install
pnpm --filter web dev              # apps/web の開発サーバ
supabase functions serve           # Edge Function のローカル実行
supabase db push                   # supabase/migrations の適用
```

## 実装の優先順位

M1 の AI 抽出パイプラインと食材正規化に最も時間を割く。**材料の取りこぼしは買い物リストの破綻に直結し、プロダクト全体の価値を決める**（Spec §5.3・Architecture §8）。PWA 化とショートカットは最後でよく、合計 4 日程度で済む。
