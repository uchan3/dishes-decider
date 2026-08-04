/**
 * 抽出対象 URL の検証（SSRF 対策の判定ロジック。仕様書 §7）。
 *
 * 内部アドレス（localhost / リンクローカル / プライベート IP）を指す URL を拒否する。
 * 純粋関数として core に置き、Edge Function の fetch 前検証と PWA 側の事前検証で共有する。
 * 実際の fetch 強制（リダイレクト再検証等）は Edge Function 側の責務。
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** プライベート/予約 IPv4 か判定する。 */
export function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const oct = m.slice(1).map(Number);
  if (oct.some((n) => n > 255)) return true; // 不正 IP は拒否側に倒す
  const [a, b] = oct as [number, number, number, number];
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // ループバック
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // リンクローカル
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** 内部/予約ホスト名か判定する。 */
export function isInternalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1") return true; // IPv6 ループバック
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  if (isPrivateIpv4(h)) return true;
  return false;
}

/** URL 検証の結果。 */
export type UrlCheck = { ok: true; href: string } | { ok: false; reason: string };

/**
 * 抽出対象 URL を検証する。http/https 以外、または内部アドレスは拒否する。
 *
 * @example
 * ```ts
 * validateExternalUrl("https://example.com/r"); // { ok: true, href: ... }
 * validateExternalUrl("http://localhost/x");     // { ok: false, reason: ... }
 * ```
 */
export function validateExternalUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "URL の形式が不正です" };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: `許可されないスキームです: ${url.protocol}` };
  }
  if (isInternalHost(url.hostname)) {
    return { ok: false, reason: "内部アドレスへのアクセスは拒否されます" };
  }
  return { ok: true, href: url.href };
}
