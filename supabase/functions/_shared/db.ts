/**
 * Edge Function から Supabase DB を操作する薄いラッパ。
 *
 * サービスロールキー（`SUPABASE_SERVICE_ROLE_KEY`、ランタイムが自動注入）で接続し、
 * ingest トークンの照合・レート制限・ジョブ/レシピ挿入を行う。RLS を跨ぐため、
 * user_id は毎回明示的に指定する。生トークンは保存せず、ハッシュで照合する。
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { deriveSource, type SourceHint } from "@recipe-planner/core/extraction";
import type {
  ExtractedIngredient,
  RecipeExtractionResult,
  ExtractionMethod,
} from "@recipe-planner/core/extraction";
import {
  classifyIngredient,
  createIngredientIndex,
  normalizeIngredientName,
  stripAmountFromIngredientName,
} from "@recipe-planner/core/normalize";
import { hashIngestToken } from "@recipe-planner/core/tokens";

/** サービスロールのクライアントを生成する。 */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * 生トークンを SHA-256 の16進ハッシュに変換する（保存・照合はハッシュで）。
 * 発行側（PWA）と同じ実装を使うため core から再エクスポートする。
 */
export const hashToken = hashIngestToken;

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

/** 食材マスタの照合に使う最小の行。 */
interface IngredientMasterRow {
  id: string;
  canonical_name: string;
  aliases: string[] | null;
}

/** マスタ 1 件から照合対象の名前（正規名 + 別名）を取り出す。 */
const masterKeys = (m: IngredientMasterRow): string[] => [m.canonical_name, ...(m.aliases ?? [])];

/**
 * 原典 URL から収集元を同定し、無ければ作成して `sources.id` を返す（F-01-2 / US-03）。
 *
 * 既存ソースの名前は上書きしない（ユーザーが設定画面で付け直した名前を守るため）。
 * 同定できない・作成に失敗した場合は null を返し、レシピは `source_id` なしで保存する
 * （取り込み自体は成功させる方が価値が高い）。
 */
async function ensureSource(
  db: SupabaseClient,
  userId: string,
  url: string,
  hint: SourceHint,
): Promise<string | null> {
  const derived = deriveSource(url, hint);
  const find = () =>
    db
      .from("sources")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", derived.kind)
      .eq("identifier", derived.identifier)
      .maybeSingle();

  const { data: existing } = await find();
  if (existing) return existing.id as string;

  const { data: inserted, error } = await db
    .from("sources")
    .insert({
      user_id: userId,
      name: derived.name,
      kind: derived.kind,
      identifier: derived.identifier,
    })
    .select("id")
    .single();
  if (!error && inserted) return inserted.id as string;

  // unique (user_id, kind, identifier) 競合＝並行取り込み。作られた行を取り直す。
  const { data: retry } = await find();
  if (retry) return retry.id as string;

  console.log(`[ingest] sources 作成失敗: ${error?.message ?? "unknown"}`);
  return null;
}

/**
 * 抽出された材料を食材マスタに紐付け、`recipe_ingredients.ingredient_id` に入れる値を返す。
 *
 * 未登録の食材は {@link classifyIngredient} で売場カテゴリ・常備品を推定して新規作成する。
 * ここで紐付かないと買い物リストの合算・売場順ソート・常備品除外（F-03-1 / US-10）が
 * 機能しないため、取り込みパイプラインの中で最も価値の高い処理。
 *
 * 失敗しても取り込みは止めず null（未紐付け）で通す。買い物リストは表示名でフォールバック
 * 集約されるため、値が全く出ないよりは劣化して出る方がよい。
 *
 * @returns `ingredients` と同じ並び・同じ長さの ID 配列（紐付かなかった要素は null）
 */
async function resolveIngredientIds(
  db: SupabaseClient,
  userId: string,
  ingredients: readonly ExtractedIngredient[],
): Promise<(string | null)[]> {
  if (ingredients.length === 0) return [];

  // user_id が null の行はシステム共通マスタ。自分の行と併せて照合対象にする。
  const { data, error } = await db
    .from("ingredients")
    .select("id, canonical_name, aliases")
    .or(`user_id.eq.${userId},user_id.is.null`);
  if (error) {
    console.log(`[ingest] ingredients 取得失敗: ${error.message}`);
    return ingredients.map(() => null);
  }

  const index = createIngredientIndex((data ?? []) as IngredientMasterRow[], masterKeys);

  // 未登録の食材を集める（同一レシピ内の重複は正規化キーで 1 つに畳む）。
  const pending = new Map<string, { name: string; unit: string | null }>();
  for (const ing of ingredients) {
    // 抽出が「にんにく 1かけ」のように分量込みの名前を返すことがある。マスタ名は
    // 分量を落として作る（そのまま作ると「にんにく」と別物になり合算されない）。
    const name = stripAmountFromIngredientName(ing.displayName);
    const key = normalizeIngredientName(name);
    if (key === "" || pending.has(key) || index.match(ing.displayName)) continue;
    pending.set(key, { name, unit: ing.unit });
  }

  if (pending.size > 0) {
    const rows = [...pending.values()].map(({ name, unit }) => {
      const { category, isPantryStaple } = classifyIngredient(name);
      return {
        user_id: userId,
        canonical_name: name,
        aliases: [],
        category,
        default_unit: unit,
        is_pantry_staple: isPantryStaple,
        sort_order: 0,
      };
    });
    const { data: created, error: insertErr } = await db
      .from("ingredients")
      .insert(rows)
      .select("id, canonical_name, aliases");
    if (insertErr) {
      console.log(`[ingest] ingredients 作成失敗: ${insertErr.message}`);
    } else {
      for (const row of (created ?? []) as IngredientMasterRow[]) index.add(row);
    }
  }

  return ingredients.map((ing) => index.match(ing.displayName)?.id ?? null);
}

/**
 * 抽出結果を recipes / recipe_ingredients に保存し、ジョブを success/partial に更新。
 *
 * 併せて収集元（sources）の同定・食材マスタ（ingredients）への紐付けも行う。
 */
export async function persistExtraction(
  db: SupabaseClient,
  userId: string,
  jobId: string,
  sourceUrl: string,
  method: ExtractionMethod,
  result: RecipeExtractionResult,
  sourceHint: SourceHint = {},
): Promise<string> {
  const hasAllSteps = result.steps.every((s) => s.summary !== null);
  const status = result.ingredients.length > 0 && hasAllSteps ? "success" : "partial";

  const [sourceId, ingredientIds] = await Promise.all([
    ensureSource(db, userId, sourceUrl, sourceHint),
    resolveIngredientIds(db, userId, result.ingredients),
  ]);

  const { data: recipe, error: recipeErr } = await db
    .from("recipes")
    .insert({
      user_id: userId,
      source_id: sourceId,
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
        ingredient_id: ingredientIds[i] ?? null,
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
