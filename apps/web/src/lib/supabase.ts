/**
 * Supabase クライアント（PWA 用）。
 *
 * URL / publishable key は公開値（`VITE_` 環境変数）。露出は想定内で、行アクセスは
 * RLS が防御する。Supabase の新キー体系では **publishable key（`sb_publishable_...`）が
 * anon key の推奨後継**（クライアント用）。旧 anon key も後方互換で受ける。
 * Gemini/YouTube や secret key は Edge Function 側にのみ置き、ここには含めない。
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

/** 環境変数が揃っているか（未設定なら PWA はローカル Dexie のみで動く）。 */
export const isSupabaseConfigured = Boolean(url && publishableKey);

/**
 * 単一の Supabase クライアント。未設定時もクラッシュしないようダミー値で生成する
 * （実際の呼び出しは `isSupabaseConfigured` を確認してから行う）。
 */
export const supabase: SupabaseClient = createClient(
  url ?? "https://placeholder.supabase.co",
  publishableKey ?? "placeholder-key",
  { auth: { persistSession: true, autoRefreshToken: true } },
);
