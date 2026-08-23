/**
 * 食材マスタの統合（仕様書 §5.3 の「後で統合を提案する」の実装）。
 *
 * 取り込みも手動入力も、正規化キーで一致しなければ新しいマスタを作る。そのため
 * 「玉ねぎ」と「たまねぎ（新玉）」のように**同じ食材が別マスタに分かれる**ことが避けられず、
 * 分かれたままだと買い物リストで合算されない。ここでは 2 つのマスタを 1 つに寄せ、
 * 消える側の名前を残る側の `aliases` に取り込む（次回以降は照合でヒットする）。
 */

import { normalizeIngredientName, stripAmountFromIngredientName } from "@recipe-planner/core";
import { db, type IngredientRow } from "../db/schema.ts";
import { enqueue } from "./outbox.ts";
import { flushSoon } from "./outboxSync.ts";
import { addToPantry, removeFromPantry } from "./pantry.ts";

/** 候補として挙げた根拠。 */
export type MergeReason = "same_name" | "contained";

/** 統合候補のペア。 */
export interface MergeSuggestion {
  /** 残す側（材料での使用数が多い方）。 */
  target: IngredientRow;
  /** 吸収される側。 */
  source: IngredientRow;
  /** なぜ候補に挙がったか。 */
  reason: MergeReason;
}

/**
 * 統合後に残す側が持つべき別名を作る（純粋関数）。
 *
 * 消える側の正規名と別名を取り込み、正規化キーで重複を除く。これがあるので
 * 次に同じ表記で取り込んでも新しいマスタが作られない。
 */
export function mergedAliases(target: IngredientRow, source: IngredientRow): string[] {
  const seen = new Set([normalizeIngredientName(target.canonical_name)]);
  const result: string[] = [];
  for (const name of [...target.aliases, source.canonical_name, ...source.aliases]) {
    const key = normalizeIngredientName(name);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

/**
 * 統合候補の組を提案する（純粋関数）。
 *
 * **わざと保守的に判定する**。統合は取り消せないので、誤った候補を出すくらいなら
 * 出さない方がよい。文字 3-gram の類似度は「牛こま切れ肉」と「豚こま切れ肉」のように
 * 語尾が共通なだけの別物を高く評価してしまうため使わない。候補にするのは次の 2 つだけ:
 *
 *   - `same_name`: 正規化キーが完全に一致（同時登録などで分かれた真の重複）
 *   - `contained`: 片方の名前がもう片方を丸ごと含み、かつ売場カテゴリも同じ
 *     （「玉ねぎ」と「玉ねぎ（新玉）」など）
 *
 * これ以外の表記ゆれ（「玉ねぎ」と「玉葱」など）は機械的に判定できないので、
 * 手動の統合 UI に任せる。
 *
 * @param masters - 判定対象の食材マスタ
 * @param usageCount - 食材 ID → 使用している材料行の数（多い方を残す側にする）
 */
export function suggestMerges(
  masters: readonly IngredientRow[],
  usageCount: ReadonlyMap<string, number>,
): MergeSuggestion[] {
  const suggestions: MergeSuggestion[] = [];

  for (let i = 0; i < masters.length; i++) {
    for (let j = i + 1; j < masters.length; j++) {
      const a = masters[i] as IngredientRow;
      const b = masters[j] as IngredientRow;
      const nameA = normalizeIngredientName(a.canonical_name);
      const nameB = normalizeIngredientName(b.canonical_name);
      if (nameA === "" || nameB === "") continue;

      let reason: MergeReason | null = null;
      if (nameA === nameB) reason = "same_name";
      else if (
        a.category === b.category &&
        (nameA.includes(nameB) || nameB.includes(nameA))
      ) {
        reason = "contained";
      }
      if (reason === null) continue;

      // 包含なら「含まれる側」＝より一般的な名前を残す（「にんにく 1かけ」ではなく
      // 「にんにく」を残したい）。同名なら使用数が多い方、それも同じなら短い方を残す。
      const usageA = usageCount.get(a.id) ?? 0;
      const usageB = usageCount.get(b.id) ?? 0;
      const aWins =
        reason === "contained"
          ? nameA.length <= nameB.length
          : usageA !== usageB
            ? usageA > usageB
            : a.canonical_name.length <= b.canonical_name.length;
      suggestions.push({ target: aWins ? a : b, source: aWins ? b : a, reason });
    }
  }

  // 確実な重複（同名）を先に出す。
  return suggestions.sort((x, y) => (x.reason === y.reason ? 0 : x.reason === "same_name" ? -1 : 1));
}

/** 統合の結果。 */
export interface MergeResult {
  /** 付け替えた材料行の数。 */
  relinked: number;
  /** 残った側に増えた別名。 */
  aliases: string[];
}

/**
 * 食材マスタ 2 件を 1 件に統合する。
 *
 * 材料行と買い物リスト項目の参照を残す側に付け替え、別名を引き継いで、消える側を削除する。
 * 変更は送信キュー経由で Supabase にも反映される。
 *
 * @param targetId - 残す側の食材 ID
 * @param sourceId - 吸収される側の食材 ID
 */
export async function mergeIngredients(
  targetId: string,
  sourceId: string,
): Promise<MergeResult> {
  if (targetId === sourceId) return { relinked: 0, aliases: [] };

  const [target, source] = await Promise.all([
    db.ingredients.get(targetId),
    db.ingredients.get(sourceId),
  ]);
  if (!target || !source) throw new Error("統合する食材が見つかりません。");

  const aliases = mergedAliases(target, source);
  const lines = await db.recipeIngredients.where("ingredient_id").equals(sourceId).toArray();
  // shoppingItems の ingredient_id はインデックスされていないためメモリ側で絞る。
  const items = (await db.shoppingItems.toArray()).filter(
    (item) => item.ingredient_id === sourceId,
  );
  const relinkedLines = lines.map((line) => ({ ...line, ingredient_id: targetId }));
  const now = new Date().toISOString();

  await db.transaction(
    "rw",
    db.ingredients,
    db.recipeIngredients,
    db.shoppingItems,
    async () => {
      await db.ingredients.update(targetId, { aliases });
      if (relinkedLines.length > 0) await db.recipeIngredients.bulkPut(relinkedLines);
      if (items.length > 0) {
        await db.shoppingItems.bulkPut(
          items.map((item) => ({ ...item, ingredient_id: targetId, updated_at: now })),
        );
      }
      await db.ingredients.delete(sourceId);
    },
  );

  // 冷蔵庫に消える側が入っていたら残る側に移す（pantry_items.id は食材 ID そのもの）。
  if (await db.pantryItems.get(sourceId)) {
    await addToPantry(targetId);
    await removeFromPantry(sourceId);
  }

  // 送信順: 参照の付け替えが先、消す側は最後（外部キーの整合を保つ）。
  await enqueue("ingredients", targetId, "put");
  for (const line of relinkedLines) await enqueue("recipeIngredients", line.id, "put");
  for (const item of items) await enqueue("planDocs", item.meal_plan_id, "put");
  await enqueue("ingredients", sourceId, "delete");
  flushSoon();

  return { relinked: relinkedLines.length, aliases };
}

/** 名前に分量が混ざったマスタ（「にんにく 1かけ」など）。 */
export interface DirtyMaster {
  master: IngredientRow;
  /** 分量を落とした名前。 */
  cleanName: string;
}

/**
 * 名前に分量が混ざっているマスタを列挙する（純粋関数）。
 *
 * 抽出が `display_name` に分量を入れてしまった時期に作られた行を拾う。
 */
export function findDirtyMasters(masters: readonly IngredientRow[]): DirtyMaster[] {
  const dirty: DirtyMaster[] = [];
  for (const master of masters) {
    const cleanName = stripAmountFromIngredientName(master.canonical_name);
    if (normalizeIngredientName(cleanName) === normalizeIngredientName(master.canonical_name)) {
      continue;
    }
    dirty.push({ master, cleanName });
  }
  return dirty;
}

/** 名前の整理結果。 */
export interface TidyResult {
  /** 対象だったマスタの数。 */
  scanned: number;
  /** 名前を直しただけの数。 */
  renamed: number;
  /** 既存のきれいなマスタに統合した数。 */
  merged: number;
}

/**
 * 名前に混ざった分量を取り除く保守処理。
 *
 * 同じ食材のきれいなマスタが既にあれば**そちらに統合**し、無ければ名前だけ直す。
 * 統合は {@link mergeIngredients} を通すので、材料行・買い物リストの参照も付け替わる。
 */
export async function tidyIngredientNames(): Promise<TidyResult> {
  const masters = await db.ingredients.toArray();
  const dirty = findDirtyMasters(masters);
  if (dirty.length === 0) return { scanned: 0, renamed: 0, merged: 0 };

  // きれいな名前 → マスタ。統合先を探すのに使う。
  const byCleanKey = new Map<string, IngredientRow>();
  for (const master of masters) {
    const key = normalizeIngredientName(master.canonical_name);
    if (!byCleanKey.has(key)) byCleanKey.set(key, master);
  }

  let renamed = 0;
  let merged = 0;
  for (const { master, cleanName } of dirty) {
    const target = byCleanKey.get(normalizeIngredientName(cleanName));
    if (target && target.id !== master.id) {
      await mergeIngredients(target.id, master.id);
      merged++;
      continue;
    }
    await db.ingredients.update(master.id, { canonical_name: cleanName });
    await enqueue("ingredients", master.id, "put");
    byCleanKey.set(normalizeIngredientName(cleanName), { ...master, canonical_name: cleanName });
    renamed++;
  }
  flushSoon();

  return { scanned: dirty.length, renamed, merged };
}
