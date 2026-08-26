/**
 * 冷蔵庫（使い切りリスト）とレシピの突き合わせ（docs/pantry.md §5・§7）。
 *
 * 「このレシピは家にある材料でどれくらい作れるか」を求める。献立生成の加点と、
 * ライブラリの「今作れる」検索の両方がこの結果を使うため、core に置いて共有する。
 *
 * 対象にするのは **食材マスタに紐付いていて・常備品でなく・曖昧量でない材料**だけ。
 *   - 未紐付けの材料は在庫と突き合わせようがない
 *   - 常備品（醤油など）は常に家にある前提なので、あってもなくても点が動かない方がよい
 *   - 「適量」の調味料が在庫にあるかで点が動くのは不自然
 */

import type { IngredientCategory, RecipeIngredient } from "../types/index.ts";

/** 突き合わせの結果。 */
export interface PantryMatch {
  /** 在庫にある対象材料の割合 `[0, 1]`。対象が 0 件なら 0。 */
  score: number;
  /** 在庫にある対象材料の数。 */
  matched: number;
  /** 足りない対象材料の数（「あと N 品」の N）。 */
  missing: number;
  /** 突き合わせの対象になった材料の数。 */
  targetCount: number;
}

/** 突き合わせの入力。 */
export interface PantryMatchInput {
  ingredients: readonly RecipeIngredient[];
  /** 冷蔵庫に入っている食材 ID。 */
  pantryIngredientIds: ReadonlySet<string>;
  /** 常備品判定。未指定なら常備品なしとして扱う。 */
  isPantryStaple?: (ingredientId: string) => boolean;
}

const EMPTY: PantryMatch = { score: 0, matched: 0, missing: 0, targetCount: 0 };

/**
 * レシピ 1 件と冷蔵庫を突き合わせる（純粋関数）。
 *
 * 対象材料が 0 件のレシピ（材料が未紐付けだけ、常備品だけ等）は `score: 0` を返す。
 * **ペナルティにはしない**。在庫が空でも献立生成が壊れないための性質。
 *
 * @example
 * ```ts
 * matchPantry({ ingredients, pantryIngredientIds: new Set(["ing-onion"]) });
 * // → { score: 0.5, matched: 1, missing: 1, targetCount: 2 }
 * ```
 */
export function matchPantry(input: PantryMatchInput): PantryMatch {
  const isStaple = input.isPantryStaple ?? (() => false);

  let matched = 0;
  let targetCount = 0;
  for (const ingredient of input.ingredients) {
    const id = ingredient.ingredientId;
    if (id === null || ingredient.isAmbiguous || isStaple(id)) continue;
    targetCount++;
    if (input.pantryIngredientIds.has(id)) matched++;
  }

  if (targetCount === 0) return EMPTY;
  return {
    score: matched / targetCount,
    matched,
    missing: targetCount - matched,
    targetCount,
  };
}

/**
 * 「そろそろ使った方がいい」と見なすまでの日数（docs/pantry.md §4）。
 *
 * 生鮮とそれ以外で分ける。**自動削除はしない**ので、外れても実害は「表示が薄くなる」だけ。
 */
export const STALE_DAYS: Readonly<Record<IngredientCategory, number>> = {
  vegetable: 5,
  meat: 5,
  seafood: 5,
  dairy_egg: 5,
  dry_goods: 14,
  frozen: 14,
  seasoning: 14,
  other: 14,
};

/** 1 日のミリ秒。 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 冷蔵庫に入れてから日が経ったか（純粋関数）。
 *
 * @param addedAt - 冷蔵庫に入れた時刻（ISO 文字列）
 * @param category - 食材の売場カテゴリ。不明なら生鮮でない扱い
 * @param now - 判定時刻（テスト用に注入可能）
 */
export function isStalePantryItem(
  addedAt: string,
  category: IngredientCategory | null,
  now: Date = new Date(),
): boolean {
  const added = new Date(addedAt).getTime();
  if (Number.isNaN(added)) return false;
  const days = STALE_DAYS[category ?? "other"] ?? STALE_DAYS.other;
  return now.getTime() - added > days * MS_PER_DAY;
}
