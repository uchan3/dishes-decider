/** アプリ設定の読み書き（Dexie の settings キー・バリューストア）。 */

import { db } from "../db/schema.ts";
import {
  DEFAULT_WEEKDAY_TEMPLATES,
  type TemplateId,
  type WeekdayTemplates,
} from "./mealTemplates.ts";

const KEY_WEEKDAY_TEMPLATES = "weekday_templates";

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
