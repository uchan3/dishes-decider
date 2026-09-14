/**
 * PWA からのレシピ取り込み依頼（B-4 / US-01）。
 *
 * これまで取り込みの入口は iOS ショートカットだけだった。PC・Android からも入れられる
 * よう、画面に貼った URL をそのまま Edge Function に投げる経路をここに置く。
 *
 * 認証は**ログイン中のセッション（Supabase JWT）**を使う。ショートカット用の長期
 * トークンをブラウザに置くと、失効させる手段がないまま残ってしまうため発行しない。
 *
 * 取り込みは非同期（Edge Function は即 202）なので、ここは「依頼して job_id を得る」
 * ところまで。結果の追跡は {@link getImportJob} と Realtime に任せる。
 */

import { validateExternalUrl, type UrlCheck } from "@recipe-planner/core";
import { supabase, isSupabaseConfigured } from "./supabase.ts";
import { ingestEndpoint } from "./ingestTokens.ts";

/** 文字列中から最初の http(s) URL を取り出す。 */
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/i;

/** 貼り付けの末尾に付いてきやすい記号（日本語の括弧・句読点を含む）。 */
const TRAILING_NOISE = /[)\]}>）］｝、。，．,.!?！？」』】〉》"'`]+$/;

/**
 * 入力欄の文字列を取り込み可能な URL に正規化する（純粋関数）。
 *
 * 共有された文字列は「タイトル\nURL」のように URL 以外を含むことが多いので、
 * **文字列の中から URL を拾う**。スキームを省いたホスト名（`example.com/recipe`）は
 * https を補う。最後に core の SSRF 判定を通し、Edge Function が 400 を返す条件を
 * 送信前に同じ基準で弾く（往復を 1 回減らし、理由もその場で出せる）。
 *
 * @param input - 入力欄の生の値
 * @returns 成功なら正規化済み `href`、失敗なら日本語の理由
 *
 * @example
 * ```ts
 * normalizeIngestUrl("バズレシピ https://youtu.be/abc123 "); // → { ok: true, href: "https://youtu.be/abc123" }
 * normalizeIngestUrl("メモだけ");                             // → { ok: false, reason: "URL が見つかりません…" }
 * ```
 */
export function normalizeIngestUrl(input: string): UrlCheck {
  const text = input.trim();
  if (text === "") return { ok: false, reason: "URL を入力してください" };

  const found = text.match(URL_PATTERN);
  let candidate = found ? found[0] : null;

  if (candidate === null) {
    // スキーム無しの 1 語（`example.com/recipe/1`）だけは https を補って救う。
    // 空白を含む＝文章なので、その場合は URL ではないと判断する。
    const bare = text.split(/\s+/)[0] as string;
    if (!/\s/.test(text) && /^[\w.-]+\.[a-z]{2,}(\/|$|\?)/i.test(bare)) {
      candidate = `https://${bare}`;
    }
  }
  if (candidate === null) {
    return { ok: false, reason: "URL が見つかりません。レシピのページの URL を貼ってください" };
  }

  return validateExternalUrl(candidate.replace(TRAILING_NOISE, ""));
}

/** 取り込み依頼の結果。 */
export interface IngestRequestResult {
  jobId: string;
}

/**
 * Edge Function に取り込みを依頼する。
 *
 * ブラウザからはページ本文を取得できない（CORS）ため、常にサーバー fetch 経路
 * （`{ url }` のみ）で投げる。Bot 対策の厳しいサイトはここで失敗しうるが、その場合は
 * ジョブの `error` に理由が残り、ショートカット（端末取得の `content` 経路）に
 * 逃がせる。
 *
 * @param url - {@link normalizeIngestUrl} を通した URL
 * @returns 作成された取り込みジョブの ID
 * @throws Supabase 未設定・未ログイン・エンドポイントがエラーを返した場合
 */
export async function submitIngest(url: string): Promise<IngestRequestResult> {
  if (!isSupabaseConfigured) throw new Error("Supabase が設定されていません。");
  const endpoint = ingestEndpoint();
  if (!endpoint) throw new Error("取り込み先の URL が設定されていません。");

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("ログインが必要です。");

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // ゲートウェイに触られない独自ヘッダを主経路にする（Edge 側と対）。
        "x-supabase-auth": accessToken,
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new Error("取り込みサーバーに接続できませんでした。通信状態を確認してください。");
  }

  const body = (await res.json().catch(() => null)) as
    | { jobId?: string; error?: string }
    | null;
  if (!res.ok) {
    throw new Error(body?.error ?? `取り込みの依頼に失敗しました (HTTP ${res.status})`);
  }
  if (!body?.jobId) throw new Error("取り込みは受理されましたが、ジョブ ID を取得できませんでした。");
  return { jobId: body.jobId };
}
