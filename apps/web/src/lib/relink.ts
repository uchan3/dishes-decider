/**
 * 未紐付けの材料を食材マスタに再照合する保守処理（§5.3）。
 *
 * 取り込みパイプラインが `ingredient_id` を埋めるようになる前に取り込んだレシピは、
 * 材料がマスタに紐付いていない。その状態では買い物リストのカテゴリが「その他」に落ち、
 * 常備品除外（US-10）も効かないため、既存ライブラリを後から救済できるようにする。
 *
 * 照合・カテゴリ推定は取り込みパイプラインと同じ core のロジックを使う。
 */

import { classifyIngredient } from "@recipe-planner/core";
import { supabase, isSupabaseConfigured } from "./supabase.ts";
import { db, type IngredientRow, type RecipeIngredientRow } from "../db/schema.ts";
import { ingredientIndex } from "./ingredients.ts";

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

const uuid = (): string => crypto.randomUUID();

/**
 * `ingredient_id` が null の材料行を食材マスタに紐付ける。
 *
 * 既存マスタに一致しない食材は、売場カテゴリと常備品フラグを推定して新規作成する。
 * Supabase が設定済みかつログイン中なら、同じ変更を Supabase にも反映する
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
    const name = line.display_name.trim();
    let master = index.match(name);
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

  let synced = false;
  if (isSupabaseConfigured && userId !== null) {
    // Dexie 行は Supabase と 1:1 なのでそのまま upsert できる（材料は全列を持つ）。
    if (newMasters.length > 0) {
      const { error: ingErr } = await supabase
        .from("ingredients")
        .insert(newMasters.map((m) => ({ ...m, user_id: userId })));
      if (ingErr) throw new Error(`食材マスタの同期に失敗しました: ${ingErr.message}`);
    }
    const { error: lineErr } = await supabase.from("recipe_ingredients").upsert(updatedLines);
    if (lineErr) throw new Error(`材料の同期に失敗しました: ${lineErr.message}`);
    synced = true;
  }

  return {
    scanned: pending.length,
    linked: updatedLines.length,
    created: newMasters.length,
    synced,
  };
}
