/**
 * 食材マスタ照合の Dexie 向けアダプタ。
 *
 * 照合ロジック本体は core の {@link createIngredientIndex}（正規化キー + 別名）にあり、
 * 取り込みパイプライン（supabase/functions）と共有している。ここは Dexie の
 * snake_case 行から照合対象の名前を取り出すだけの薄い層。
 */

import {
  createIngredientIndex,
  matchIngredientMaster,
  type IngredientIndex,
} from "@recipe-planner/core";
import { db, type IngredientRow } from "../db/schema.ts";
import { enqueue } from "./outbox.ts";
import { flushSoon } from "./outboxSync.ts";

/** マスタ行から照合対象の名前（正規名 + 別名）を取り出す。 */
const keysOf = (m: IngredientRow): string[] => [m.canonical_name, ...m.aliases];

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
  return matchIngredientMaster(name, masters, keysOf);
}

/**
 * 食材マスタの索引を作る。連続して照合する場合（フォームの全材料など）はこちらを使う。
 * 新規作成したマスタを `add` で足せば、同じ入力内の重複を 1 つのマスタに収束できる。
 */
export function ingredientIndex(
  masters: readonly IngredientRow[],
): IngredientIndex<IngredientRow> {
  return createIngredientIndex(masters, keysOf);
}

/**
 * 食材の常備品フラグを切り替える（US-10）。
 *
 * 常備品は買い物リストから既定で除外される。Dexie だけ直すと次回プルで巻き戻るため
 * 送信キュー経由で Supabase にも反映する。
 */
export async function setPantryStaple(id: string, isPantryStaple: boolean): Promise<void> {
  await db.ingredients.update(id, { is_pantry_staple: isPantryStaple });
  await enqueue("ingredients", id, "put");
  flushSoon();
}
