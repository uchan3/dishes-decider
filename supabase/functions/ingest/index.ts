/**
 * POST /ingest — レシピ取り込みエンドポイント（architecture §3）。
 *
 * iOS ショートカット / PWA から `{ url }`（任意で `content`）を受け取り、即 202 を
 * 返してから `EdgeRuntime.waitUntil()` で抽出を継続する。
 *
 * 2 経路:
 *   - `{ url }` のみ → サーバー側で fetch して抽出（通常サイト）
 *   - `{ url, content, contentKind }` → 端末で取得済みの本文から抽出（サーバー fetch を
 *     行わない）。Cloudflare 等の Bot 対策サイトや YouTube 概要欄はこちらを使う。
 *
 * 認証は 2 種類（{@link readCredential}）:
 *   - **ingest トークン**（`x-ingest-token`）… iOS ショートカット。期限の無い長期トークン
 *   - **Supabase JWT**（`x-supabase-auth`）… PWA からの取り込み。ログイン中のセッション
 *
 * フロー: 資格情報の照合 → レート制限 → import_jobs(pending) → 202 →
 *   （背景）抽出 → 類似度ゲート → 収集元の同定・食材マスタ紐付け → recipes 挿入 →
 *   job 更新。結果は Realtime で PWA に届く。
 */

import { validateExternalUrl } from "@recipe-planner/core/extraction";
import { looksLikeJwt } from "@recipe-planner/core/tokens";
import { extractFromContent, runExtraction, type ContentKind } from "../_shared/pipeline.ts";
import { selectProvider } from "../_shared/provider-select.ts";
import {
  createImportJob,
  failJob,
  hashToken,
  persistExtraction,
  resolveIngestToken,
  resolveJwtUser,
  serviceClient,
  withinRateLimit,
} from "../_shared/db.ts";

/** 受信トークンのハッシュ先頭8文字（照合ずれのデバッグ用。全体は出さない）。 */
async function debugHashPrefix(token: string): Promise<string> {
  return (await hashToken(token)).slice(0, 8);
}

interface EdgeRuntimeLike {
  waitUntil(promise: Promise<unknown>): void;
}
declare const EdgeRuntime: EdgeRuntimeLike | undefined;

function runInBackground(promise: Promise<unknown>): void {
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(promise);
  else void promise;
}

/**
 * CORS ヘッダ。PWA（Cloudflare のドメイン）から Supabase のドメインを叩くため、
 * これが無いとブラウザからの取り込みはプリフライトで落ちる。
 *
 * 資格情報は Cookie ではなく明示的なヘッダで渡すので `*` で足りる
 * （ブラウザが勝手に付ける認証情報が無く、オリジンを絞る意味が薄いため）。
 */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "authorization, x-ingest-token, x-supabase-auth, apikey, content-type",
  "access-control-max-age": "86400",
};

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });

/** 受け取った資格情報。照合先が違うので種別を持たせる。 */
interface Credential {
  kind: "token" | "jwt";
  value: string;
}

/**
 * 資格情報を取り出す。優先順位は 独自ヘッダ → `Authorization: Bearer`。
 *
 * Supabase ゲートウェイは `Authorization` を自前の用途で差し替えることがあるため、
 * 独自ヘッダを主経路にする（iOS ショートカットも PWA も独自ヘッダを送れる）。
 * `Authorization` で来た場合は形で振り分ける（JWT は `.` 区切り 3 セグメント）。
 */
function readCredential(req: Request): Credential | null {
  const token = req.headers.get("x-ingest-token")?.trim();
  if (token) return { kind: "token", value: token };

  const jwt = req.headers.get("x-supabase-auth")?.trim();
  if (jwt) return { kind: "jwt", value: jwt };

  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (m) {
    const value = (m[1] as string).trim();
    return { kind: looksLikeJwt(value) ? "jwt" : "token", value };
  }
  return null;
}

Deno.serve(async (req: Request) => {
  // ブラウザからの POST はプリフライトが先に来る。
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST のみ許可" }, 405);

  const credential = readCredential(req);
  if (!credential) return json({ error: "認証情報が必要です" }, 401);

  let payload: { url?: string; content?: string; contentKind?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "JSON ボディが不正です" }, 400);
  }
  const url = payload.url?.trim();
  if (!url) return json({ error: "url は必須です" }, 400);

  // content が渡された場合は端末側で取得済み（Bot 対策サイト・YouTube 概要欄など）。
  // サーバー fetch を行わないので SSRF の懸念はないが、URL は保存・表示に使うため常に検証する。
  const content = typeof payload.content === "string" ? payload.content : null;
  const contentKind: ContentKind = payload.contentKind === "text" ? "text" : "html";

  const check = validateExternalUrl(url);
  if (!check.ok) return json({ error: check.reason }, 400);

  const db = serviceClient();

  const userId =
    credential.kind === "jwt"
      ? await resolveJwtUser(db, credential.value)
      : await resolveIngestToken(db, credential.value);
  if (!userId) {
    if (credential.kind === "token") {
      // デバッグ: 受信トークンのハッシュ先頭のみログ（照合ずれの切り分け用。全体は出さない）。
      const dbg = await debugHashPrefix(credential.value);
      console.log(`[ingest] token mismatch: len=${credential.value.length} hashPrefix=${dbg}`);
      return json({ error: "無効な ingest トークンです" }, 401);
    }
    return json({ error: "ログインの有効期限が切れています。入り直してください" }, 401);
  }

  if (!(await withinRateLimit(db, userId))) {
    return json({ error: "レート上限に達しました（1時間あたり60件）" }, 429);
  }

  const jobId = await createImportJob(db, userId, url);

  // 即 202。抽出はバックグラウンドで継続。
  runInBackground(
    (async () => {
      try {
        const provider = selectProvider();
        // content があれば端末取得の本文から抽出（fetch しない）、無ければサーバー fetch。
        const { result, method, finalUrl, sourceHint } = content
          ? await extractFromContent(url, content, contentKind, { provider })
          : await runExtraction(url, { provider });
        await persistExtraction(db, userId, jobId, finalUrl, method, result, sourceHint);
      } catch (err) {
        await failJob(db, jobId, err instanceof Error ? err.message : String(err));
      }
    })(),
  );

  return json({ status: "accepted", jobId }, 202);
});
