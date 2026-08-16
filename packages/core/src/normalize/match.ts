/**
 * 食材名から既存マスタを照合する索引（仕様書 §5.3）。
 *
 * 買い物リストの合算は `ingredient_id` を軸に行うため、取り込み時に「この材料は既存の
 * どのマスタか」を決められるかがプロダクトの生命線になる。照合そのものは
 * {@link normalizeIngredientName} の正規化キー（NFKC → ひらがな → 空白除去 → 小文字）と、
 * マスタが持つ別名 (`aliases`) の両方で行う。
 *
 * 呼び出し側の行型は snake_case (Dexie / Supabase) と camelCase (ドメイン層) で異なるため、
 * 照合対象の名前を取り出す関数 `keysOf` を受け取る形にして型を持ち込まない。
 */

import { normalizeIngredientName } from "./name.ts";

/** マスタ 1 件から照合に使う名前（正規名 + 別名）を取り出す関数。 */
export type IngredientMasterKeys<T> = (master: T) => readonly string[];

/**
 * 食材名 → マスタの索引。
 *
 * 取り込み中に新規作成したマスタを {@link IngredientIndex.add} で足しながら使えるため、
 * 同一レシピ内に同じ食材が 2 回出てきても 1 つのマスタに収束する。
 */
export interface IngredientIndex<T> {
  /** 正規化キーが一致するマスタを返す。無ければ undefined。 */
  match(name: string): T | undefined;
  /** 新規作成したマスタを索引に加える（以降の照合対象になる）。 */
  add(master: T): void;
}

/**
 * 食材マスタの索引を作る。
 *
 * @param masters - 既存マスタ一覧
 * @param keysOf - マスタから照合対象の名前を取り出す関数（正規名と別名を返す）
 *
 * @example
 * ```ts
 * const index = createIngredientIndex(rows, (m) => [m.canonical_name, ...m.aliases]);
 * index.match("タマネギ"); // → canonical_name が「玉ねぎ」の行（aliases に「たまねぎ」がある場合）
 * ```
 */
export function createIngredientIndex<T>(
  masters: readonly T[],
  keysOf: IngredientMasterKeys<T>,
): IngredientIndex<T> {
  const byKey = new Map<string, T>();

  const add = (master: T): void => {
    for (const raw of keysOf(master)) {
      const key = normalizeIngredientName(raw);
      // 先勝ち: 既存マスタ同士が衝突した場合は先に登録された方を正とする。
      if (key !== "" && !byKey.has(key)) byKey.set(key, master);
    }
  };

  for (const master of masters) add(master);

  return {
    match(name: string): T | undefined {
      const key = normalizeIngredientName(name);
      return key === "" ? undefined : byKey.get(key);
    },
    add,
  };
}

/**
 * 一度きりの照合を行う簡易版（索引を保持しない）。
 *
 * @param name - 入力された食材名
 * @param masters - 照合対象の食材マスタ一覧
 * @param keysOf - マスタから照合対象の名前を取り出す関数
 * @returns 一致したマスタ、なければ undefined
 */
export function matchIngredientMaster<T>(
  name: string,
  masters: readonly T[],
  keysOf: IngredientMasterKeys<T>,
): T | undefined {
  return createIngredientIndex(masters, keysOf).match(name);
}
