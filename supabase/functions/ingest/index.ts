/**
 * POST /ingest — レシピ取り込みエンドポイント（architecture §3）。
 *
 * iOS ショートカットから URL を受け取り、即 202 を返してから
 * `EdgeRuntime.waitUntil()` で抽出を継続する（ショートカットを待たせない）。
 *
 * 現状: 抽出パイプラインまでを配線。DB 永続化（import_jobs / recipes 挿入）と
 * ingest トークン照合・レート制限は Supabase プロジェクト作成後に有効化する（下記 TODO）。
 */

import { validateExternalUrl } from "@recipe-planner/core/extraction";
import { runExtraction } from "../_shared/pipeline.ts";
import { selectProvider } from "../_shared/provider-select.ts";

/** waitUntil を持たない環境（ローカル）でも動くフォールバック。 */
interface EdgeRuntimeLike {
  waitUntil(promise: Promise<unknown>): void;
}
declare const EdgeRuntime: EdgeRuntimeLike | undefined;

function runInBackground(promise: Promise<unknown>): void {
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(promise);
  else void promise; // ローカル: 発火して忘れる
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST のみ許可" }, 405);

  // TODO(supabase): Authorization: Bearer <ingest-token> をハッシュ照合して user_id を解決。
  //   レート制限（1 トークン 60 件/時）とリボーク（revoked_at）もここで判定する。

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

  // TODO(supabase): import_jobs に status=pending で INSERT し、その id を返す。
  const jobId = crypto.randomUUID();

  // 即 202。抽出はバックグラウンドで継続。
  runInBackground(
    (async () => {
      try {
        const provider = selectProvider();
        const { result, method, finalUrl } = await runExtraction(url, { provider });
        // TODO(supabase): recipes / recipe_ingredients に INSERT、
        //   import_jobs を status=success に UPDATE、Realtime で PWA に通知。
        console.log(
          `[ingest] extracted via ${method} from ${finalUrl}: ` +
            `${result.title} (${result.ingredients.length} ingredients, ${result.steps.length} steps)`,
        );
      } catch (err) {
        // TODO(supabase): import_jobs を status=failed に UPDATE。
        console.error(`[ingest] extraction failed for ${url}:`, err);
      }
    })(),
  );

  return json({ status: "accepted", jobId }, 202);
});
