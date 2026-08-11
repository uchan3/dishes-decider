/**
 * Edge Function から Supabase DB を操作する薄いラッパ。
 *
 * サービスロールキー（`SUPABASE_SERVICE_ROLE_KEY`、ランタイムが自動注入）で接続し、
 * ingest トークンの照合・レート制限・ジョブ/レシピ挿入を行う。RLS を跨ぐため、
 * user_id は毎回明示的に指定する。生トークンは保存せず、ハッシュで照合する。
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { RecipeExtractionResult, ExtractionMethod } from "@recipe-planner/core/extraction";

/** サービスロールのクライアントを生成する。 */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** 生トークンを SHA-256 の16進ハッシュに変換する（保存・照合はハッシュで）。 */
export async function hashToken(rawToken: string): Promise<string> {
  const data = new TextEncoder().encode(rawToken);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** ingest トークンを検証し user_id を返す。無効・失効なら null。 */
export async function resolveIngestToken(
  db: SupabaseClient,
  rawToken: string,
): Promise<string | null> {
  const tokenHash = await hashToken(rawToken);
  const { data, error } = await db
    .from("ingest_tokens")
    .select("id, user_id, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  // 照合ずれの切り分け用ログ（ハッシュ先頭16文字のみ。生トークンは出さない）。
  console.log(
    `[ingest] token lookup: hash16=${tokenHash.slice(0, 16)} ` +
      `found=${!!data} revoked=${data?.revoked_at ?? "-"} ` +
      `error=${error ? `${error.code}:${error.message}` : "none"}`,
  );
  if (error || !data || data.revoked_at) return null;
  // 最終利用時刻を更新（ベストエフォート）。
  await db.from("ingest_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data.user_id as string;
}

/** 直近1時間のジョブ数がレート上限（既定60）以内かを返す。 */
export async function withinRateLimit(
  db: SupabaseClient,
  userId: string,
  limitPerHour = 60,
): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await db
    .from("import_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (error) return true; // 計測失敗時は通す（可用性優先）
  return (count ?? 0) < limitPerHour;
}

/** import_jobs に pending 行を作成し id を返す。 */
export async function createImportJob(
  db: SupabaseClient,
  userId: string,
  url: string,
): Promise<string> {
  const { data, error } = await db
    .from("import_jobs")
    .insert({ user_id: userId, url, status: "pending" })
    .select("id")
    .single();
  if (error) throw new Error(`import_jobs 作成失敗: ${error.message}`);
  return data.id as string;
}

/** 抽出結果を recipes / recipe_ingredients に保存し、ジョブを success/partial に更新。 */
export async function persistExtraction(
  db: SupabaseClient,
  userId: string,
  jobId: string,
  sourceUrl: string,
  method: ExtractionMethod,
  result: RecipeExtractionResult,
): Promise<string> {
  const hasAllSteps = result.steps.every((s) => s.summary !== null);
  const status = result.ingredients.length > 0 && hasAllSteps ? "success" : "partial";

  const { data: recipe, error: recipeErr } = await db
    .from("recipes")
    .insert({
      user_id: userId,
      title: result.title,
      source_url: sourceUrl,
      step_summaries: result.steps.map((s) => ({
        position: s.position,
        summary: s.summary,
        similarity_score: s.similarityScore ?? null,
      })),
      extraction_status: status,
      extracted_by: method,
      extracted_at: new Date().toISOString(),
      dish_roles: result.dishRoles,
      cook_time_min: result.cookTimeMin,
      servings: result.servings ?? 2,
      main_ingredient_category: result.mainIngredientCategory,
      cooking_method: result.cookingMethod,
      tags: result.tags,
    })
    .select("id")
    .single();
  if (recipeErr) throw new Error(`recipes 挿入失敗: ${recipeErr.message}`);

  const recipeId = recipe.id as string;
  if (result.ingredients.length > 0) {
    const { error: ingErr } = await db.from("recipe_ingredients").insert(
      result.ingredients.map((ing, i) => ({
        recipe_id: recipeId,
        raw_text: ing.rawText,
        display_name: ing.displayName,
        quantity: ing.quantity,
        unit: ing.unit,
        is_ambiguous: ing.quantity === null,
        position: i,
      })),
    );
    if (ingErr) throw new Error(`recipe_ingredients 挿入失敗: ${ingErr.message}`);
  }

  await db.from("import_jobs").update({ status, recipe_id: recipeId }).eq("id", jobId);
  return recipeId;
}

/** ジョブを失敗として記録する。 */
export async function failJob(db: SupabaseClient, jobId: string, message: string): Promise<void> {
  await db.from("import_jobs").update({ status: "failed", error: message.slice(0, 500) }).eq("id", jobId);
}
