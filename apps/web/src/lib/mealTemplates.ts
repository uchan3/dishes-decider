/**
 * 献立構成テンプレート（仕様書 §5.2）と曜日ごとの割り当て（US-07）。
 *
 * MVP はプリセット固定。曜日ごとにどのテンプレを使うかをユーザーが選べる。
 * 週開始は月曜のため、割り当ては月曜起点の 7 要素配列で保持する。
 */

import type { DishRole } from "@recipe-planner/core";

/** テンプレートのプリセット ID。 */
export type TemplateId =
  | "standard"
  | "hearty"
  | "main_only"
  | "one_dish"
  | "with_soup"
  | "eat_out";

/** テンプレート定義。 */
export interface MealTemplate {
  id: TemplateId;
  name: string;
  /** スロット構成。空配列 = 献立生成をスキップ（外食・作らない）。 */
  slots: DishRole[];
}

/** プリセット一覧（表示順）。 */
export const TEMPLATES: MealTemplate[] = [
  { id: "standard", name: "標準（主菜+副菜）", slots: ["main", "side"] },
  { id: "hearty", name: "がっつり（主菜+副菜×2）", slots: ["main", "side", "side"] },
  { id: "main_only", name: "主菜のみ", slots: ["main"] },
  { id: "one_dish", name: "一皿完結", slots: ["one_dish"] },
  { id: "with_soup", name: "汁物付き（主菜+副菜+汁物）", slots: ["main", "side", "soup"] },
  { id: "eat_out", name: "外食・作らない", slots: [] },
];

const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t] as const));

/** ID からテンプレートを引く（未知 ID は標準にフォールバック）。 */
export function templateById(id: string): MealTemplate {
  return TEMPLATE_BY_ID.get(id as TemplateId) ?? (TEMPLATES[0] as MealTemplate);
}

/**
 * 曜日ごとのテンプレ割り当て。月曜起点の 7 要素（月→日）。
 * 既定は平日=標準・土日=がっつり。
 */
export type WeekdayTemplates = [
  TemplateId,
  TemplateId,
  TemplateId,
  TemplateId,
  TemplateId,
  TemplateId,
  TemplateId,
];

/** 既定の曜日割り当て（月〜金=標準 / 土日=がっつり）。 */
export const DEFAULT_WEEKDAY_TEMPLATES: WeekdayTemplates = [
  "standard",
  "standard",
  "standard",
  "standard",
  "standard",
  "hearty",
  "hearty",
];

/** 曜日ラベル（月起点）。 */
export const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"] as const;

/** `YYYY-MM-DD` を月曜起点のインデックス（0=月 … 6=日）に変換する。 */
export function mondayIndex(date: string): number {
  const dow = new Date(`${date}T00:00:00`).getDay(); // 0=Sun..6=Sat
  return (dow + 6) % 7;
}
