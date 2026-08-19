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
 *
 * 抽出が「にんにく 1かけ」のように分量込みの名前を返すことがあるため、正規化キーに加えて
 * **末尾の分量を落としたキー**でも引けるようにしてある（{@link stripAmountFromIngredientName}）。
 */

import { normalizeIngredientName } from "./name.ts";
import { stripAmountFromIngredientName } from "./amount.ts";

/** 正規化キーと、末尾の分量を落とした正規化キー。 */
function keyPair(raw: string): { exact: string; stripped: string } {
  return {
    exact: normalizeIngredientName(raw),
    stripped: normalizeIngredientName(stripAmountFromIngredientName(raw)),
  };
}

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
  /** 名前そのままのキー。 */
  const byExact = new Map<string, T>();
  /** 末尾の分量を落としたキー。分量込みで登録されたマスタを拾うための保険。 */
  const byStripped = new Map<string, T>();

  const add = (master: T): void => {
    for (const raw of keysOf(master)) {
      const { exact, stripped } = keyPair(raw);
      // 先勝ち: 既存マスタ同士が衝突した場合は先に登録された方を正とする。
      if (exact !== "" && !byExact.has(exact)) byExact.set(exact, master);
      if (stripped !== "" && stripped !== exact && !byStripped.has(stripped)) {
        byStripped.set(stripped, master);
      }
    }
  };

  for (const master of masters) add(master);

  return {
    match(name: string): T | undefined {
      const { exact, stripped } = keyPair(name);
      // 完全一致を最優先し、分量を落とした照合はその後に試す。
      const candidates = [
        exact === "" ? undefined : byExact.get(exact),
        stripped === "" ? undefined : byExact.get(stripped),
        exact === "" ? undefined : byStripped.get(exact),
        stripped === "" ? undefined : byStripped.get(stripped),
      ];
      return candidates.find((hit) => hit !== undefined);
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
