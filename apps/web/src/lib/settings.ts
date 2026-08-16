/** アプリ設定の読み書き（Dexie の settings キー・バリューストア）。 */

import { db } from "../db/schema.ts";
import {
  DEFAULT_WEEKDAY_TEMPLATES,
  type TemplateId,
  type WeekdayTemplates,
} from "./mealTemplates.ts";

const KEY_WEEKDAY_TEMPLATES = "weekday_templates";
const KEY_PLANNING = "planning_settings";

const VALID_IDS = new Set<TemplateId>([
  "standard",
  "hearty",
  "main_only",
  "one_dish",
  "with_soup",
  "eat_out",
]);

/** 保存値が壊れていても安全に既定へフォールバックする。 */
function sanitize(value: unknown): WeekdayTemplates {
  if (!Array.isArray(value) || value.length !== 7) return [...DEFAULT_WEEKDAY_TEMPLATES];
  const result = value.map((v, i) =>
    VALID_IDS.has(v as TemplateId) ? (v as TemplateId) : DEFAULT_WEEKDAY_TEMPLATES[i],
  );
  return result as WeekdayTemplates;
}

/** 曜日別テンプレ割り当てを取得する（未保存なら既定）。 */
export async function loadWeekdayTemplates(): Promise<WeekdayTemplates> {
  const row = await db.settings.get(KEY_WEEKDAY_TEMPLATES);
  return sanitize(row?.value);
}

/** 曜日別テンプレ割り当てを保存する。 */
export async function saveWeekdayTemplates(value: WeekdayTemplates): Promise<void> {
  await db.settings.put({ key: KEY_WEEKDAY_TEMPLATES, value });
}

/**
 * 献立生成・買い物リストの設定（仕様書 F-02-1）。
 *
 * core の `GenerationSettings` のうち、ユーザーが触る意味のある項目だけを持つ
 * （重み・softmax 温度などのチューニング値は既定のまま）。
 */
export interface PlanningSettings {
  /** 世帯人数。買い物リストのスケーリングに使う。 */
  householdSize: number;
  /** この日数以内に作ったレシピは献立に出さない。 */
  cooldownDays: number;
  /** 平日の調理時間上限（分）。null = 制限なし。 */
  weekdayMaxCookMin: number | null;
  /** 休日の調理時間上限（分）。null = 制限なし。 */
  weekendMaxCookMin: number | null;
}

/** 既定値（F-02-1 の表に合わせる: 平日 30 分・休日は制限なし・クールダウン 14 日）。 */
export const DEFAULT_PLANNING_SETTINGS: PlanningSettings = {
  householdSize: 2,
  cooldownDays: 14,
  weekdayMaxCookMin: 30,
  weekendMaxCookMin: null,
};

/** 数値を範囲内に丸める。値として使えなければ既定値を返す。 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 上限（分）。null / 空 / 不正値は「制限なし」に倒す。 */
function optionalMinutes(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(600, Math.round(n));
}

/**
 * 保存値・入力値を安全な {@link PlanningSettings} に正規化する（純粋関数）。
 *
 * 設定は Dexie にそのまま入るため、壊れた値や範囲外の値が生成ロジックに流れないよう
 * ここで必ず通す。
 *
 * @example
 * ```ts
 * normalizePlanningSettings({ householdSize: 0 }).householdSize;   // 1（最小値に丸め）
 * normalizePlanningSettings({ weekendMaxCookMin: "" }).weekendMaxCookMin; // null（制限なし）
 * ```
 */
export function normalizePlanningSettings(value: unknown): PlanningSettings {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    householdSize: clampInt(raw.householdSize, 1, 12, DEFAULT_PLANNING_SETTINGS.householdSize),
    cooldownDays: clampInt(raw.cooldownDays, 0, 365, DEFAULT_PLANNING_SETTINGS.cooldownDays),
    weekdayMaxCookMin:
      "weekdayMaxCookMin" in raw
        ? optionalMinutes(raw.weekdayMaxCookMin)
        : DEFAULT_PLANNING_SETTINGS.weekdayMaxCookMin,
    weekendMaxCookMin:
      "weekendMaxCookMin" in raw
        ? optionalMinutes(raw.weekendMaxCookMin)
        : DEFAULT_PLANNING_SETTINGS.weekendMaxCookMin,
  };
}

/** 生成設定を取得する（未保存なら既定）。 */
export async function loadPlanningSettings(): Promise<PlanningSettings> {
  const row = await db.settings.get(KEY_PLANNING);
  return normalizePlanningSettings(row?.value);
}

/** 生成設定を保存する（保存前に正規化する）。 */
export async function savePlanningSettings(value: PlanningSettings): Promise<PlanningSettings> {
  const normalized = normalizePlanningSettings(value);
  await db.settings.put({ key: KEY_PLANNING, value: normalized });
  return normalized;
}
