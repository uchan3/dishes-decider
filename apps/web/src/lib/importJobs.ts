/**
 * 取り込みジョブの可視化（architecture §3.1）。
 *
 * 取り込みは非同期（Edge Function は即 202 を返す）なので、失敗しても PWA からは
 * 何も分からなかった。ここで直近のジョブを取得し、成功・失敗・処理中を画面に出す。
 */

import { supabase, isSupabaseConfigured } from "./supabase.ts";

/** 取り込みジョブ 1 件。 */
export interface ImportJobRow {
  id: string;
  url: string;
  status: "pending" | "success" | "partial" | "failed";
  recipe_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** 処理中のまま放置されたとみなすまでの時間（architecture §3.1 の救済と同じ 10 分）。 */
export const STALL_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * ジョブが「処理中のまま止まっている」か（純粋関数）。
 *
 * 抽出は 5〜15 秒で終わるため、10 分 pending のままなら Edge Function が落ちたか
 * 応答を書けなかったとみなす。UI では失敗と同じ扱いで見せる。
 *
 * @param now - 判定時刻（テスト用に注入可能）
 */
export function isStalled(job: ImportJobRow, now: Date = new Date()): boolean {
  if (job.status !== "pending") return false;
  return now.getTime() - new Date(job.created_at).getTime() > STALL_THRESHOLD_MS;
}

/** 直近の取り込みジョブを新しい順に取得する。 */
export async function listRecentImportJobs(limit = 10): Promise<ImportJobRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from("import_jobs")
    .select("id, url, status, recipe_id, error, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`取り込み状況の取得に失敗しました: ${error.message}`);
  return (data ?? []) as ImportJobRow[];
}
