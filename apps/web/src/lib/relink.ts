/**
 * 未紐付けの材料を食材マスタに再照合する保守処理（§5.3）。
 *
 * 取り込みパイプラインが `ingredient_id` を埋めるようになる前に取り込んだレシピは、
 * 材料がマスタに紐付いていない。その状態では買い物リストのカテゴリが「その他」に落ち、
 * 常備品除外（US-10）も効かないため、既存ライブラリを後から救済できるようにする。
 *
 * 照合・カテゴリ推定は取り込みパイプラインと同じ core のロジックを使う。
 */

import { classifyIngredient, stripAmountFromIngredientName } from "@recipe-planner/core";
import { isSupabaseConfigured } from "./supabase.ts";
import { db, type IngredientRow, type RecipeIngredientRow } from "../db/schema.ts";
import { ingredientIndex } from "./ingredients.ts";
import { newId } from "./ids.ts";
import { enqueue } from "./outbox.ts";
import { flushSoon } from "./outboxSync.ts";

/** 再照合の結果。 */
export interface RelinkResult {
  /** 未紐付けだった材料行の数。 */
  scanned: number;
  /** 紐付けできた材料行の数。 */
  linked: number;
  /** 新規作成した食材マスタの数。 */
  created: number;
  /** Supabase にも反映したか（未設定・未ログインなら false）。 */
  synced: boolean;
}

const uuid = newId;

/**
 * `ingredient_id` が null の材料行を食材マスタに紐付ける。
 *
 * 既存マスタに一致しない食材は、売場カテゴリと常備品フラグを推定して新規作成する。
 * Supabase が設定済みかつログイン中なら、同じ変更を送信キューに積む
 * （Dexie だけ直すと次回プルで巻き戻るため）。
 *
 * @param userId - ログイン中のユーザー ID。null なら Dexie のみ更新する
 */
export async function relinkIngredients(userId: string | null): Promise<RelinkResult> {
  const allLines = await db.recipeIngredients.toArray();
  // IndexedDB は null をキーにできないため、未紐付けの抽出はメモリ側で行う。
  const pending = allLines.filter(
    (line) => line.ingredient_id === null && line.display_name.trim() !== "",
  );
  if (pending.length === 0) {
    return { scanned: 0, linked: 0, created: 0, synced: false };
  }

  const index = ingredientIndex(await db.ingredients.toArray());
  const newMasters: IngredientRow[] = [];
  const updatedLines: RecipeIngredientRow[] = [];

  for (const line of pending) {
    // マスタ名は分量を落とした形で作る（「にんにく 1かけ」→「にんにく」）。
    const name = stripAmountFromIngredientName(line.display_name);
    let master = index.match(line.display_name);
    if (!master) {
      const { category, isPantryStaple } = classifyIngredient(name);
      master = {
        id: uuid(),
        canonical_name: name,
        kana: null,
        aliases: [],
        category,
        default_unit: line.unit,
        is_pantry_staple: isPantryStaple,
        sort_order: 0,
      };
      newMasters.push(master);
      index.add(master);
    }
    updatedLines.push({ ...line, ingredient_id: master.id });
  }

  await db.transaction("rw", db.ingredients, db.recipeIngredients, async () => {
    if (newMasters.length > 0) await db.ingredients.bulkAdd(newMasters);
    await db.recipeIngredients.bulkPut(updatedLines);
  });

  // Supabase への反映は送信キュー経由（オフラインでも再照合できる）。
  // 外部キーの順に積む: 食材マスタ → 材料。
  for (const master of newMasters) await enqueue("ingredients", master.id, "put");
  for (const line of updatedLines) await enqueue("recipeIngredients", line.id, "put");
  const queued = isSupabaseConfigured && userId !== null;
  if (queued) flushSoon();

  return {
    scanned: pending.length,
    linked: updatedLines.length,
    created: newMasters.length,
    synced: queued,
  };
}
