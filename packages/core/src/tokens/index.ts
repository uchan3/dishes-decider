/**
 * ingest トークンの生成とハッシュ化（architecture §3.2）。
 *
 * iOS ショートカットは Supabase の JWT を持てない（期限切れする）ため、専用の長期
 * トークンを発行する。**生トークンは保存しない**: 発行時に一度だけ表示し、DB には
 * SHA-256 ハッシュだけを置く。
 *
 * 発行するのは PWA（ブラウザ）、照合するのは Edge Function（Deno）なので、
 * **両者が同じハッシュを出すこと**が必須。実装が分かれると照合できなくなるため
 * core に置いて共有する。Web Crypto はブラウザ・Deno の双方にある。
 */

/** バイト列を base64url（パディング無し）に変換する。 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 新しい ingest トークンを作る（暗号論的乱数）。
 *
 * @param byteLength - 乱数のバイト長（既定 32 = 256 bit）
 * @returns URL やヘッダにそのまま置ける base64url 文字列
 */
export function generateIngestToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * ingest トークンを SHA-256 の 16 進ハッシュに変換する（保存・照合はこの値で行う）。
 *
 * @example
 * ```ts
 * const raw = generateIngestToken();
 * await hashIngestToken(raw); // → "9f86d0..."（64 文字の16進）
 * ```
 */
export async function hashIngestToken(rawToken: string): Promise<string> {
  const data = new TextEncoder().encode(rawToken);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
