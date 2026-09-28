# 週間献立プランナー（dishes-decider）

集めたレシピから **1 週間の献立を自動生成し、買い物リストまで作る** PWA。
「今日何作る？」を毎日考えるのをやめて、週末に 1 タップで決めて、あとは買い出しに行くだけにするためのもの。

```
レシピを集める  →  週の献立を生成  →  買い物リスト  →  作った記録
（URL を貼る /      （1 タップ。        （売場順に集約。   （次回のクールダウンと
  ショートカット）     手直しも可）        オフライン動作）    出やすさに反映）
```

## 設計の柱

| | |
|---|---|
| **月額 0 円** | ネイティブアプリでなく PWA、有料 API でなく Gemini の無料枠。これが構成上の絶対条件 |
| **オフラインファースト** | 読み取りは常に端末内 DB（IndexedDB）から。書き込みは端末に書いてから送信キュー経由で同期。**店内で電波が切れても買い物リストは完全に動く** |
| **二人で共有** | レシピ・献立・買い物リスト・冷蔵庫・設定が端末間で同期する。買い物中に別々の項目をチェックしても消えない |
| **レシピの原文を保存しない** | 取り込み時に要約を作って原文は破棄する。手順は原典（YouTube 埋め込み / リンク）で見る。要約が原文をなぞっていないか機械的に検査している |

詳しい背景と仕様は [`docs/`](docs/) に置いてある（下の[ドキュメント](#ドキュメント)を参照）。

## 画面

| タブ | できること |
|---|---|
| **献立** | 週の生成・作り直し / 枠ごとの再抽選・ロック・空にする・ライブラリから指定 / その日を外食にする / 日ごとの構成変更 / 「作った」記録 |
| **レシピ** | 検索（料理名・タグ・**材料名**）、役割・収集元・調理時間・お気に入りで絞り込み、冷蔵庫の中身から「在庫で作れる順」「あと 2 品まで」 |
| **追加** | URL を貼って自動取り込み / 手入力 |
| **買い物** | 売場カテゴリ別のチェックリスト、内訳（どのレシピで使うか）、数量の手直し、手動追加、冷蔵庫（使い切りリスト） |
| **設定** | 曜日ごとの献立構成、世帯人数・クールダウン・調理時間上限、収集元の有効無効、常備品、食材マスタの統合、取り込みトークン発行と取り込み状況、同期状況 |

---

## 動かす

用途によって 3 通りある。**まず試すだけなら A が一番早い（5 分・アカウント不要）。**

### A. ローカルだけで試す（Supabase 不要）

レシピの手入力・献立生成・買い物リスト・冷蔵庫はすべて端末内で完結するので、Supabase なしでも中身のある動作確認ができる。URL からの自動取り込みと端末間同期だけが使えない。

```bash
corepack enable pnpm        # pnpm を有効化（初回のみ）
pnpm install
pnpm --filter @recipe-planner/web dev
```

`.env.local` を作らなければログイン画面は出ず、そのままアプリが開く。
「追加」→ 手入力でレシピを 3〜4 品入れると献立が生成できる（主菜だけだと副菜の枠が埋まらないので、役割を散らして入れるとよい）。

> Node は **22 以上**を使う（`package.json` の `engines` は `>=20` だが、20 では supabase-js の
> Realtime がネイティブ WebSocket を要求してテスト収集が落ちる。CI と Cloudflare も 22）。

### B. 自分用に本番構成で使う

Supabase（DB・認証・取り込み関数）＋ Cloudflare（PWA 配信）。どちらも無料枠。
手順は [セットアップ](#セットアップ本番構成) に。

### C. 開発

```bash
pnpm install
pnpm -r typecheck                  # 全ワークスペースの型検査
pnpm -r test                       # 全パッケージのテスト（core 156 / web 185 件）
pnpm --filter @recipe-planner/web dev
```

コードの地図と設計判断の理由は [`CLAUDE.md`](CLAUDE.md) にまとまっている（AI 向けだが人間が読んでも一次情報になる）。

---

## セットアップ（本番構成）

### 1. Supabase プロジェクトを作る

[supabase.com](https://supabase.com) で新規プロジェクトを作り、CLI を用意する。

```bash
brew install supabase/tap/supabase     # または npx supabase
supabase login
supabase link --project-ref <あなたの project ref>
```

> このリポジトリの CI は `mprrxclyflfhkwxocbtb` にデプロイする設定（`.github/workflows/ci.yml` の `PROJECT_REF`）。
> 自分のプロジェクトで動かすならここを書き換える。

### 2. スキーマを適用する

```bash
supabase db push
```

テーブル・RLS・Realtime 購読・取り込みジョブの救済関数が入る。

> **`pg_cron` が有効でないプロジェクトでは最後の `cron.schedule` が失敗する。**
> その場合は関数だけ作られた状態になるので、Dashboard → Integrations → Cron で
> `select fail_stalled_import_jobs()` を 5 分ごとに登録する。登録しなくても
> PWA 側が 10 分経過を「停止」と表示するので、致命的ではない。

**マイグレーションは自動化していない。** 影響が大きいので、追加したときは手動で `supabase db push` する。
先にデプロイしてしまうと送信キューが詰まるので、**列を足す変更はマージ前に当てる**こと。

### 3. ログインするユーザーを作る

**サインアップ画面は用意していない。** 世帯で使う道具で、誰でも登録できる必要がないため。
Supabase Dashboard → **Authentication → Users → Add user** で作る。

- メールアドレスとパスワードを入れ、**Auto Confirm User をオンにする**（確認メールを送らずに使える状態にする）
- **二人で使うときは同じアカウントを共有する。** 行アクセスは `user_id = auth.uid()` で判定しているので、別アカウントだとライブラリも献立も別々になる（世帯を表すテーブルは作っていない）

### 4. 取り込み関数をデプロイする

```bash
supabase functions deploy ingest
```

main への push で CI が自動デプロイする（リポジトリの Secrets に `SUPABASE_ACCESS_TOKEN` を入れておく。未設定ならスキップされる）。
**Cloudflare のビルドは PWA だけを配信する**ので、関数を直したのに本番の挙動が変わらないときは、まずデプロイ漏れを疑う。

環境変数は Dashboard → Edge Functions → Secrets、または CLI で設定する。

```bash
supabase secrets set GEMINI_API_KEY=...
```

| 変数 | 必須 | 効果 |
|---|---|---|
| `GEMINI_API_KEY` | ほぼ必須 | レシピ抽出の主経路。**未設定だとモック抽出**になり、材料はほとんど取れない |
| `YOUTUBE_API_KEY` | 任意 | 概要欄を Data API で確実に取る。未設定でも HTML から拾うが不確実。**収集元がチャンネル別に分かれるのは設定済みのときだけ** |
| `ANTHROPIC_API_KEY` | 任意 | Gemini が失敗したときの品質フォールバック（Claude Haiku）。**ここだけ有料**。未設定なら 0 円構成のまま |
| `GEMINI_MODEL` / `GEMINI_LITE_MODEL` / `ANTHROPIC_MODEL` | 任意 | モデルの上書き |

> API キーは **Edge Function の環境変数にだけ**置く。PWA のバンドルに入れてはいけない（クライアント JS は誰でも読める）。

### 5. PWA を配信する（Cloudflare Workers Static Assets）

GitHub 連携（Workers Builds）で自動ビルドする。設定値はこれだけ。

| 項目 | 値 |
|---|---|
| Build command | `pnpm --filter @recipe-planner/web build` |
| Deploy command | `npx wrangler deploy` |
| Path / Root | `/`（モノレポなので必ずルート。`packages/core` を workspace 解決する） |
| Build variables | `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` / `NODE_VERSION=22` |

- ビルド変数は**ビルド時に焼き込まれる**ので、変更は次のビルドから反映される（既存デプロイには遡らない。すぐ反映したいときは Retry）
- SPA の deep link は `wrangler.jsonc` の `not_found_handling` が担う。**`_redirects` は置かないこと**（`/* /index.html 200` が無限ループ判定でデプロイ失敗する）

ローカルで本番同等に動かす場合は `apps/web/.env.local` に同じ値を書く。

```bash
cp apps/web/.env.example apps/web/.env.local   # 中身を自分の値に書き換える
```

キーは **publishable key**（`sb_publishable_...`）を推奨。旧 anon key も `VITE_SUPABASE_ANON_KEY` で受ける。どちらも公開前提の値で、行アクセスは RLS が守る。

### 6. 動くか確かめる

1. 発行された URL を開き、3 で作ったアカウントでログインする
2. 「追加」画面にレシピの URL を貼って取り込む → 数十秒で「取り込みました」とリンクが出る
3. 「献立」で生成 → 「買い物」に材料が並ぶ
4. iPhone なら Safari の共有 →「ホーム画面に追加」でアプリとして入る（PWA）

---

## レシピを入れる 4 つの経路

| 経路 | 使う場面 | 備考 |
|---|---|---|
| **URL を貼る**（追加画面） | PC・Android・とりあえず 1 件 | サーバー側がページを取得して抽出する |
| **iOS ショートカット** | iPhone で見つけた動画・記事を共有シートから | 設定画面でトークンを発行して設定する。手順は [`docs/ios-shortcut.md`](docs/ios-shortcut.md)。**本文を端末側で取得するので、Bot 対策の厳しいサイトでも通る** |
| **Instagram はキャプションを貼る** | Instagram の投稿 | ログイン必須でサーバーからもショートカットからも本文が読めない。URL を入れると貼り付け欄が出る |
| **手入力** | 本・家庭の味・URL が無いもの | 材料だけ入れれば買い物リストに乗る |

取り込みは非同期（5〜15 秒）。結果は設定画面の「取り込み状況」に残り、失敗したジョブはそこから**再取り込み**できる。

JSON-LD（schema.org/Recipe）が取れるサイトは LLM を呼ばずに構造化するので、コストも時間もかからない。

---

## 費用

| | 月額 |
|---|---|
| Cloudflare Workers（PWA 配信） | 0 円（無料枠） |
| Supabase Free（Postgres / Auth / Edge Functions / Realtime） | 0 円 |
| Gemini Flash 無料枠（抽出は 1 レシピにつき生涯 1 回だけ） | 0 円 |
| **合計** | **0 円** |

`ANTHROPIC_API_KEY` を設定した場合だけ、Gemini が失敗したときのフォールバックに課金が発生する（Haiku 4.5 は入力 \$1 / 出力 \$5 per 1M トークン。1 レシピの本文は数 KB なので、稀に走る前提なら月数セント規模）。

---

## ドキュメント

| ファイル | 中身 |
|---|---|
| [`docs/Weekly Menu Planner Spec.md`](docs/Weekly%20Menu%20Planner%20Spec.md) | 機能仕様・ドメインモデル・データモデル・著作権上の制約 |
| [`docs/architecture.md`](docs/architecture.md) | システム構成・取り込みフロー・オフライン戦略 |
| [`docs/techstack_cost_analysis.md`](docs/techstack_cost_analysis.md) | 技術選定の根拠（すべて決定済み） |
| [`docs/pantry.md`](docs/pantry.md) | 冷蔵庫（使い切りリスト）の仕様。**厳密な在庫管理はしない**方針とその理由 |
| [`docs/ios-shortcut.md`](docs/ios-shortcut.md) | ショートカットのセットアップとトラブルシュート |
| [`CLAUDE.md`](CLAUDE.md) | コードの地図と設計判断の理由。どのファイルが何を担うか、なぜそうしたか |

> 仕様書 §9「技術スタック（案）」の Expo / React Native は**古い案**。確定スタックは PWA（Vite + React Router + Dexie.js）。

## 構成

```
packages/core/        純粋 TypeScript。依存ゼロ。ブラウザと Deno の両方から import される
                      （献立生成・買い物リスト集約・食材正規化・類似度・抽出の共有ロジック）
apps/web/             Vite + React Router の PWA。UI と、献立生成・買い物リストの実行
supabase/functions/   Deno。レシピ取り込み（抽出）パイプラインのみ
supabase/migrations/  スキーマ・RLS・Realtime（適用は手動）
```

## 現時点の制約

正直に書いておく。

- **サインアップ画面が無い。** ユーザー作成は Supabase Dashboard から（上記 3）
- **二人で使うにはアカウントを共有する。** 世帯を表すデータモデルは持っていない
- **UI の自動テストが無い。** ロジック側は 341 件あるが、画面の操作は手で確かめる必要がある
- **マイグレーションは手動。** 列を足す変更は、デプロイ前に `supabase db push` する
- 却下理由の学習・冷蔵庫はどちらも「ズレても献立の出方が少し変わるだけ」の強さに収めてある。厳密な在庫管理や好み学習は狙っていない
