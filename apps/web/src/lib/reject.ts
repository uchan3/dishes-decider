/**
 * 再抽選の却下理由を記録する（仕様書 F-02-3「却下理由の記録」）。
 *
 * `reject_count` 列は最初からあったのに誰も増やしておらず、**何度 ↻ を押しても
 * 学習しなかった**。理由によって効かせ方が違うので、ここで分岐させる。
 *
 * 訊くタイミングは**再抽選の後**にしてある。↻ は献立作りで一番よく押すボタンなので、
 * 押すたびにダイアログが出るのは邪魔でしかない。先に入れ替えてしまい、理由は任意で
 * 後から受け取る（仕様の「任意で選択させ」に沿う）。
 */

import { db } from "../db/schema.ts";
import { addDays, today } from "./date.ts";
import { excludeFromWeek } from "./planning.ts";
import { updateRecipe } from "./recipeEdit.ts";
import { loadPlanningSettings } from "./settings.ts";

/** 却下理由。値は仕様書 F-02-3 の 4 種類。 */
export type RejectReason = "not_in_mood" | "ate_recently" | "too_much_work" | "never";

/** 画面に出す文言（選ぶ側の言葉で書く）。 */
export const REJECT_REASONS: { value: RejectReason; label: string; hint: string }[] = [
  { value: "not_in_mood", label: "気分じゃない", hint: "今週は出しません" },
  { value: "ate_recently", label: "最近食べた", hint: "しばらく出しません" },
  { value: "too_much_work", label: "材料を揃えるのが面倒", hint: "出にくくします" },
  { value: "never", label: "もう出さないで", hint: "今後は出しません" },
];

/**
 * 却下理由を反映する。
 *
 * | 理由 | 効かせ方 |
 * |---|---|
 * | 気分じゃない | その週の除外リストに入れる（翌週には何事もなく戻る） |
 * | 最近食べた | クールダウン日数のあいだスヌーズする |
 * | 材料を揃えるのが面倒 | `reject_count` を増やす（スコアの reject ペナルティが効く） |
 * | もう出さないで | `is_excluded` を立てる（恒久除外） |
 *
 * **「最近食べた」を作った記録にはしない**。よそで食べただけで `cook_count` が増えると、
 * novelty スコアが実態とずれていく。記録とは別に `snoozed_until` を持たせている。
 *
 * @param reason - 選ばれた理由
 * @param recipeId - 弾かれたレシピ
 * @param planId - 対象の週（「気分じゃない」でのみ使う）
 */
export async function applyRejectReason(
  reason: RejectReason,
  recipeId: string,
  planId: string,
): Promise<void> {
  switch (reason) {
    case "not_in_mood":
      await excludeFromWeek(planId, recipeId);
      return;
    case "ate_recently": {
      const settings = await loadPlanningSettings();
      await updateRecipe(recipeId, { snoozed_until: addDays(today(), settings.cooldownDays) });
      return;
    }
    case "too_much_work": {
      const row = await db.recipes.get(recipeId);
      if (!row) return;
      await updateRecipe(recipeId, { reject_count: row.reject_count + 1 });
      return;
    }
    case "never":
      await updateRecipe(recipeId, { is_excluded: true });
      return;
  }
}
