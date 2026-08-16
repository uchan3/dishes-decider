/**
 * ingest トークンの発行・一覧・失効（architecture §3.2 / US-01）。
 *
 * iOS ショートカットから Edge Function を叩くための長期トークン。**生トークンは
 * 発行時に一度だけ返し、DB にはハッシュしか保存しない**（漏洩時の被害を限定する）。
 * 生成・ハッシュは core の実装を使い、照合する Edge Function と必ず一致させる。
 */

import { generateIngestToken, hashIngestToken } from "@recipe-planner/core";
import { supabase, isSupabaseConfigured } from "./supabase.ts";

/** 発行済みトークン（生の値は含まない）。 */
export interface IngestTokenRow {
  id: string;
  label: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** ショートカットの POST 先。Supabase の URL から決まる。 */
export function ingestEndpoint(): string | null {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  return base ? `${base.replace(/\/$/, "")}/functions/v1/ingest` : null;
}

/** 自分のトークンを新しい順に取得する。 */
export async function listIngestTokens(): Promise<IngestTokenRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from("ingest_tokens")
    .select("id, label, last_used_at, revoked_at, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`トークンの取得に失敗しました: ${error.message}`);
  return (data ?? []) as IngestTokenRow[];
}

/**
 * トークンを発行する。**戻り値の `token` はこの一度しか取得できない**
 * （DB にはハッシュのみ保存するため、後から再表示はできない）。
 *
 * @param userId - ログイン中のユーザー ID
 * @param label - 端末名などの覚え書き（例: 「iPhone のショートカット」）
 */
export async function issueIngestToken(
  userId: string,
  label: string,
): Promise<{ token: string; row: IngestTokenRow }> {
  if (!isSupabaseConfigured) throw new Error("Supabase が設定されていません。");

  const token = generateIngestToken();
  const tokenHash = await hashIngestToken(token);
  const { data, error } = await supabase
    .from("ingest_tokens")
    .insert({ user_id: userId, token_hash: tokenHash, label: label.trim() || null })
    .select("id, label, last_used_at, revoked_at, created_at")
    .single();
  if (error) throw new Error(`トークンの発行に失敗しました: ${error.message}`);
  return { token, row: data as IngestTokenRow };
}

/**
 * トークンを失効させる（行は残し、`revoked_at` を立てる）。
 * Edge Function は `revoked_at` が入った時点で受け付けなくなる。
 */
export async function revokeIngestToken(id: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await supabase
    .from("ingest_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`トークンの失効に失敗しました: ${error.message}`);
}
