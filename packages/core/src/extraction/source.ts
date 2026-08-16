/**
 * 原典 URL から収集元（source）を導出する（仕様書 F-01-2）。
 *
 * 取り込んだレシピを `sources` に紐付けないと「今週はリュウジのみ」のような
 * ソース絞り込み（US-03）が効かない。URL から機械的に決まる部分（種別・識別子）を
 * ここで求め、チャンネル名など API でしか分からない情報は `hint` で補う。
 *
 * 識別子は `(user_id, kind, identifier)` の一意キーになるため、**同じ発信者に対して
 * 常に同じ値**になることが重要。YouTube はチャンネル ID、Web はホスト名を使う。
 */

import { isYouTubeUrl } from "./youtube.ts";

/** 収集元の種別。`manual` は手動登録用でここでは返さない。 */
export type SourceKind = "youtube" | "instagram" | "web" | "manual";

/** 導出された収集元。 */
export interface DerivedSource {
  kind: SourceKind;
  /** 同一発信者を一意に指す値（YouTube: チャンネル ID / Web: ホスト名）。 */
  identifier: string;
  /** 表示名。 */
  name: string;
}

/** URL だけでは分からない情報の補足。 */
export interface SourceHint {
  /** YouTube Data API の `snippet.channelId`。 */
  channelId?: string | null;
  /** YouTube Data API の `snippet.channelTitle`。 */
  channelTitle?: string | null;
  /** HTML の `og:site_name` 等から得られたサイト名。 */
  siteName?: string | null;
}

/** URL のホスト名を返す（先頭の `www.` は落とす）。パースできなければ null。 */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Instagram の URL からユーザー名を取り出す（`/<user>/p/<id>/` 形式のみ）。 */
function instagramUser(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split("/").filter((s) => s !== "");
    const first = segments[0];
    if (first === undefined) return null;
    // 投稿単体の URL（/p/<id>/, /reel/<id>/, /tv/<id>/）は発信者を含まない。
    if (first === "p" || first === "reel" || first === "reels" || first === "tv") return null;
    return first.toLowerCase();
  } catch {
    return null;
  }
}

/** URL から導けなかった場合の収集元（保存はできるが絞り込みの役には立たない）。 */
const UNKNOWN: DerivedSource = { kind: "web", identifier: "unknown", name: "不明なソース" };

/**
 * 原典 URL（＋任意のヒント）から収集元を導出する。
 *
 * @param url - 原典 URL
 * @param hint - チャンネル名・サイト名など URL 外から得た補足情報
 *
 * @example
 * ```ts
 * deriveSource("https://www.youtube.com/watch?v=abc", { channelId: "UC1", channelTitle: "リュウジ" });
 * // → { kind: "youtube", identifier: "UC1", name: "リュウジ" }
 *
 * deriveSource("https://delishkitchen.tv/recipes/123");
 * // → { kind: "web", identifier: "delishkitchen.tv", name: "delishkitchen.tv" }
 * ```
 */
export function deriveSource(url: string, hint: SourceHint = {}): DerivedSource {
  const host = hostOf(url);
  if (host === null) return UNKNOWN;

  const channelTitle = hint.channelTitle?.trim() || null;
  const channelId = hint.channelId?.trim() || null;

  if (isYouTubeUrl(url)) {
    // チャンネルが分からない場合（API キー未設定など）は YouTube 全体を 1 ソースとして扱う。
    // 後からチャンネルが判明した取り込みは別ソースとして分かれる（識別子が変わるため）。
    return {
      kind: "youtube",
      identifier: channelId ?? channelTitle ?? "youtube.com",
      name: channelTitle ?? "YouTube",
    };
  }

  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const user = instagramUser(url);
    return {
      kind: "instagram",
      identifier: user ?? "instagram.com",
      name: user !== null ? `@${user}` : "Instagram",
    };
  }

  return { kind: "web", identifier: host, name: hint.siteName?.trim() || host };
}
