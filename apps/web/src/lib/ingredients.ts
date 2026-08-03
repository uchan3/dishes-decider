/**
 * 食材名から既存マスタを照合するヘルパー。
 *
 * core の {@link normalizeIngredientName} で正規化キーを作り、canonical_name と
 * aliases の両方に対して突き合わせる。漢字の揺れは辞書（aliases）で吸収する前提。
 */

import { normalizeIngredientName } from "@recipe-planner/core";
import type { IngredientRow } from "../db/schema.ts";

/**
 * 正規化名で一致する食材マスタを探す。
 *
 * @param name - 入力された食材名
 * @param masters - 照合対象の食材マスタ一覧
 * @returns 一致したマスタ、なければ undefined
 */
export function matchMaster(
  name: string,
  masters: readonly IngredientRow[],
): IngredientRow | undefined {
  const key = normalizeIngredientName(name);
  if (key === "") return undefined;
  return masters.find(
    (m) =>
      normalizeIngredientName(m.canonical_name) === key ||
      m.aliases.some((a) => normalizeIngredientName(a) === key),
  );
}
