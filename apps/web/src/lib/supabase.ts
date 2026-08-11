/**
 * Supabase クライアント（PWA 用）。
 *
 * URL / anon key は公開値（`VITE_` 環境変数）。anon key の露出は想定内で、行アクセスは
 * RLS が防御する。Gemini/YouTube 等の秘密鍵は Edge Function 側にのみ置き、ここには含めない。
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** 環境変数が揃っているか（未設定なら PWA はローカル Dexie のみで動く）。 */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * 単一の Supabase クライアント。未設定時もクラッシュしないようダミー URL で生成する
 * （実際の呼び出しは `isSupabaseConfigured` を確認してから行う）。
 */
export const supabase: SupabaseClient = createClient(
  url ?? "https://placeholder.supabase.co",
  anonKey ?? "placeholder-anon-key",
  { auth: { persistSession: true, autoRefreshToken: true } },
);
