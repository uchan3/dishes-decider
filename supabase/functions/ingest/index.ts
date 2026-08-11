/**
 * POST /ingest — レシピ取り込みエンドポイント（architecture §3）。
 *
 * iOS ショートカット / PWA から `Authorization: Bearer <ingest-token>` と `{ url }` を
 * 受け取り、即 202 を返してから `EdgeRuntime.waitUntil()` で抽出を継続する。
 *
 * フロー: トークン照合 → レート制限 → import_jobs(pending) → 202 →
 *   （背景）取得→JSON-LD/LLM抽出→類似度ゲート→recipes 挿入→job 更新。
 *   結果は import_jobs の Realtime 変更で PWA に届く。
 */

import { validateExternalUrl } from "@recipe-planner/core/extraction";
import { runExtraction } from "../_shared/pipeline.ts";
import { selectProvider } from "../_shared/provider-select.ts";
import {
  createImportJob,
  failJob,
  hashToken,
  persistExtraction,
  resolveIngestToken,
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

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * ingest トークンを取り出す。独自ヘッダ `x-ingest-token` を優先し、
 * 無ければ `Authorization: Bearer` にフォールバックする。
 *
 * Supabase ゲートウェイは `Authorization` を自前の用途で差し替えることがあるため、
 * 独自ヘッダを主経路にする（iOS ショートカットも独自ヘッダを送れる）。
 */
function ingestToken(req: Request): string | null {
  const custom = req.headers.get("x-ingest-token");
  if (custom && custom.trim()) return custom.trim();
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? (m[1] as string).trim() : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST のみ許可" }, 405);

  const token = ingestToken(req);
  if (!token) return json({ error: "ingest トークンが必要です" }, 401);

  let payload: { url?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "JSON ボディが不正です" }, 400);
  }
  const url = payload.url?.trim();
  if (!url) return json({ error: "url は必須です" }, 400);

  const check = validateExternalUrl(url);
  if (!check.ok) return json({ error: check.reason }, 400);

  const db = serviceClient();

  const userId = await resolveIngestToken(db, token);
  if (!userId) {
    // デバッグ: 受信トークンのハッシュ先頭のみログ（照合ずれの切り分け用。全体は出さない）。
    const dbg = await debugHashPrefix(token);
    console.log(`[ingest] token mismatch: len=${token.length} hashPrefix=${dbg}`);
    return json({ error: "無効な ingest トークンです" }, 401);
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
        const { result, method, finalUrl } = await runExtraction(url, { provider });
        await persistExtraction(db, userId, jobId, finalUrl, method, result);
      } catch (err) {
        await failJob(db, jobId, err instanceof Error ? err.message : String(err));
      }
    })(),
  );

  return json({ status: "accepted", jobId }, 202);
});
