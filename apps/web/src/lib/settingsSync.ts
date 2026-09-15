/**
 * 設定の端末間同期（A-2 / US-14 の続き）。
 *
 * 曜日ごとの献立テンプレと生成設定（世帯人数・クールダウン・調理時間上限）は Dexie に
 * しか無かった。結果、**二人が別々の設定で週を生成**し、平日 30 分の制限が片方でしか
 * 効かない、といったことが起きる。ブラウザのデータを消すと設定も消えた。
 *
 * サーバーが設定の中身を読む場面は無いので、献立ドキュメント（`planSync.ts`）と同じく
 * **クライアントの形のまま 1 ユーザー 1 行の jsonb** に入れる（`user_settings.doc`）。
 *
 * 競合解決は**ドキュメント単位の Last-Write-Wins**。買い物リストのような項目単位の
 * マージはしない（二人が同時に設定を触る場面が無く、複雑さに見合わない）。
 */

import { supabase, isSupabaseConfigured } from "./supabase.ts";
import { type WeekdayTemplates } from "./mealTemplates.ts";
import {
  applySettings,
  loadPlanningSettings,
  loadWeekdayTemplates,
  settingsUpdatedAt,
  type PlanningSettings,
} from "./settings.ts";

/** Supabase に置く設定ドキュメント。 */
export interface SettingsDocument {
  /** ドキュメント全体の更新時刻（ISO）。LWW の時計。 */
  updatedAt: string;
  weekdayTemplates: WeekdayTemplates;
  planning: PlanningSettings;
}

/**
 * 受信したドキュメントを取り込むべきか（純粋関数）。
 *
 * 手元に時刻が無い（一度も設定を触っていない）なら受け入れる。同時刻なら**受け入れない**
 * ＝手元を正とする（何度も往復させないため）。
 *
 * @example
 * ```ts
 * shouldApplySettings("", "2026-09-14T00:00:00Z");                       // → true
 * shouldApplySettings("2026-09-14T10:00:00Z", "2026-09-14T09:00:00Z");   // → false
 * ```
 */
export function shouldApplySettings(localUpdatedAt: string, remoteUpdatedAt: string): boolean {
  if (!remoteUpdatedAt) return false;
  if (!localUpdatedAt) return true;
  return remoteUpdatedAt > localUpdatedAt;
}

/** Dexie から送信用のドキュメントを組み立てる。 */
export async function buildSettingsDocument(): Promise<SettingsDocument> {
  const [weekdayTemplates, planning, updatedAt] = await Promise.all([
    loadWeekdayTemplates(),
    loadPlanningSettings(),
    settingsUpdatedAt(),
  ]);
  return {
    // 一度も触っていない設定をそのまま送ると時刻が空になり、相手が取り込めなくなる。
    updatedAt: updatedAt || new Date().toISOString(),
    weekdayTemplates,
    planning,
  };
}

/** 設定を Supabase に送る（1 ユーザー 1 行）。 */
export async function pushSettingsDocument(
  userId: string,
  doc: SettingsDocument,
): Promise<void> {
  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: userId, doc }, { onConflict: "user_id" });
  if (error) throw new Error(`設定の送信に失敗: ${error.message}`);
}

/** Supabase の行を {@link SettingsDocument} に戻す。壊れていれば null。 */
function toDocument(row: Record<string, unknown> | null): SettingsDocument | null {
  const doc = row?.doc as Partial<SettingsDocument> | null;
  if (!doc || typeof doc.updatedAt !== "string") return null;
  if (!doc.weekdayTemplates || !doc.planning) return null;
  return {
    updatedAt: doc.updatedAt,
    weekdayTemplates: doc.weekdayTemplates,
    planning: doc.planning,
  };
}

/**
 * 受信したドキュメントを Dexie に反映する。
 *
 * 値の健全化（曜日テンプレの検証・生成設定の範囲丸め）は `applySettings` が担うので、
 * 相手の端末が壊れた値を送ってきても生成ロジックには流れない。
 *
 * @returns 反映したら true
 */
export async function applySettingsDocument(remote: SettingsDocument): Promise<boolean> {
  if (!shouldApplySettings(await settingsUpdatedAt(), remote.updatedAt)) return false;
  await applySettings(remote.weekdayTemplates, remote.planning, remote.updatedAt);
  return true;
}

/**
 * Supabase から設定を取得して Dexie に反映する。
 *
 * @returns 反映したら true
 */
export async function pullSettings(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const { data, error } = await supabase.from("user_settings").select("doc").maybeSingle();
  if (error) throw new Error(`設定の取得に失敗しました: ${error.message}`);
  const doc = toDocument((data as Record<string, unknown>) ?? null);
  return doc === null ? false : applySettingsDocument(doc);
}

/**
 * 相手の端末での設定変更を購読する。
 *
 * @param onChange - 反映したときに呼ばれる
 * @returns 購読解除関数
 */
export function subscribeSettings(onChange?: () => void): () => void {
  if (!isSupabaseConfigured) return () => {};

  const channel = supabase
    .channel("settings_sync")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "user_settings" },
      async () => {
        if (await pullSettings()) onChange?.();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
