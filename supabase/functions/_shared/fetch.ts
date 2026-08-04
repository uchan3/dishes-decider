/**
 * 安全な外部コンテンツ取得（SSRF 対策・タイムアウト・サイズ上限）。
 *
 * リダイレクトを手動で辿り、各ホップで内部アドレス検証を再実行する
 * （自動リダイレクトだと内部アドレスへ飛ばされる恐れがあるため）。
 */

import { validateExternalUrl } from "@recipe-planner/core/extraction";

/** 取得オプション。 */
export interface FetchOptions {
  /** タイムアウト（ミリ秒、既定 10000）。 */
  timeoutMs?: number;
  /** 最大バイト数（既定 2MB）。 */
  maxBytes?: number;
  /** 最大リダイレクト回数（既定 5）。 */
  maxRedirects?: number;
}

/** 取得結果。 */
export interface FetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
}

/**
 * 外部 URL を安全に取得する。内部アドレス（初回・リダイレクト先とも）は拒否する。
 *
 * @throws URL 検証失敗・タイムアウト・サイズ超過・非 2xx 応答で例外
 */
export async function safeFetch(rawUrl: string, options: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;

  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = validateExternalUrl(currentUrl);
    if (!check.ok) throw new Error(`URL 拒否: ${check.reason}`);
    const safeHref = check.href;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(safeHref, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "RecipePlannerBot/0.1 (+personal use)",
          accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    // リダイレクトは手動で辿る（各ホップで再検証）。
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("リダイレクト先が不明です");
      currentUrl = new URL(location, safeHref).href;
      continue;
    }

    if (!res.ok) throw new Error(`取得失敗: HTTP ${res.status}`);

    const body = await readCapped(res, maxBytes);
    return {
      finalUrl: safeHref,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      body,
    };
  }
  throw new Error("リダイレクトが多すぎます");
}

/** レスポンスボディを上限バイトまで読む（超過で例外）。 */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("コンテンツが大きすぎます");
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}
