/**
 * ライブラリ同期（Supabase → Dexie の一方向プル）。
 *
 * この初回スライスでは recipes / recipe_ingredients / sources / ingredients を
 * Supabase から取得し Dexie に反映する（UI は常に Dexie から読む＝オフライン読取）。
 * 献立・買い物リストはローカル Dexie のまま（双方向同期は後続）。
 */

import { supabase, isSupabaseConfigured } from "./supabase.ts";
import {
  db,
  type IngredientRow,
  type RecipeIngredientRow,
  type RecipeRow,
  type SourceRow,
} from "../db/schema.ts";

/** Supabase の recipes 行を Dexie の {@link RecipeRow} に写す（Dexie が持つ列のみ）。 */
function toRecipeRow(r: Record<string, unknown>): RecipeRow {
  return {
    id: r.id as string,
    source_id: (r.source_id as string) ?? null,
    title: r.title as string,
    source_url: (r.source_url as string) ?? null,
    thumbnail_url: (r.thumbnail_url as string) ?? null,
    dish_roles: (r.dish_roles as RecipeRow["dish_roles"]) ?? [],
    cook_time_min: (r.cook_time_min as number) ?? null,
    servings: (r.servings as number) ?? 2,
    main_ingredient_category: (r.main_ingredient_category as string) ?? null,
    cooking_method: (r.cooking_method as RecipeRow["cooking_method"]) ?? null,
    tags: (r.tags as string[]) ?? [],
    is_favorite: Boolean(r.is_favorite),
    is_excluded: Boolean(r.is_excluded),
    cook_count: (r.cook_count as number) ?? 0,
    last_cooked_at: (r.last_cooked_at as string) ?? null,
    reject_count: (r.reject_count as number) ?? 0,
    created_at: (r.created_at as string) ?? new Date().toISOString(),
    updated_at: (r.updated_at as string) ?? new Date().toISOString(),
  };
}

/**
 * Supabase から自ユーザーのライブラリを取得し Dexie に upsert する。
 *
 * RLS により自分の行のみ取得される。既存 Dexie 行は id で上書き（bulkPut）。
 * ローカルのみの手動レシピは Supabase 側にも書かれる前提のため、ここでは削除しない。
 *
 * @returns 取り込んだレシピ件数
 */
export async function pullLibrary(): Promise<number> {
  if (!isSupabaseConfigured) return 0;

  const [sources, ingredients, recipes, lines] = await Promise.all([
    supabase.from("sources").select("*"),
    supabase.from("ingredients").select("*"),
    supabase.from("recipes").select("*"),
    supabase.from("recipe_ingredients").select("*"),
  ]);

  const firstError = sources.error || ingredients.error || recipes.error || lines.error;
  if (firstError) throw new Error(`同期に失敗しました: ${firstError.message}`);

  await db.transaction(
    "rw",
    db.sources,
    db.ingredients,
    db.recipes,
    db.recipeIngredients,
    async () => {
      if (sources.data) await db.sources.bulkPut(sources.data as SourceRow[]);
      if (ingredients.data) await db.ingredients.bulkPut(ingredients.data as IngredientRow[]);
      if (recipes.data) {
        await db.recipes.bulkPut((recipes.data as Record<string, unknown>[]).map(toRecipeRow));
      }
      if (lines.data) {
        await db.recipeIngredients.bulkPut(lines.data as RecipeIngredientRow[]);
      }
    },
  );

  return recipes.data?.length ?? 0;
}

/**
 * 取り込みジョブの Realtime 購読を開始する。ジョブが success/partial になったら
 * ライブラリを再プルして新レシピを Dexie に反映する。
 *
 * @param onChange - 反映後に呼ばれる（件数を通知）。UI 更新のトリガに使える
 * @returns 購読解除関数
 */
export function subscribeImports(onChange?: (count: number) => void): () => void {
  if (!isSupabaseConfigured) return () => {};

  const channel = supabase
    .channel("import_jobs_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "import_jobs" },
      async (payload) => {
        const status = (payload.new as { status?: string } | null)?.status;
        if (status === "success" || status === "partial") {
          const count = await pullLibrary();
          onChange?.(count);
        }
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
