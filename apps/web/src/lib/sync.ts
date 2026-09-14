/**
 * ライブラリ同期（Supabase → Dexie の一方向プル）。
 *
 * recipes / recipe_ingredients / sources / ingredients / pantry_items を Supabase から
 * 取得し Dexie に反映する（UI は常に Dexie から読む＝オフライン読取）。
 * 献立・買い物リストは `planSync.ts` が別途扱う。
 *
 * **サーバーで消えた行はこちらでも消す**（{@link idsToDelete}）。片方の端末でレシピを
 * 削除したり食材マスタを統合したりしても、もう一方には upsert しか届かず、消したはず
 * のレシピが相手の献立に出続けていた（US-14）。
 */

import { supabase, isSupabaseConfigured } from "./supabase.ts";
import { isUuid } from "./ids.ts";
import {
  db,
  type IngredientRow,
  type PantryItemRow,
  type RecipeIngredientRow,
  type RecipeRow,
  type SourceRow,
} from "../db/schema.ts";

/** PostgREST の 1 リクエスト上限（既定 1000 行）。これを跨いで全件取るために使う。 */
const PAGE_SIZE = 1000;

/** 同期するテーブルの Dexie 名 → Supabase 名。 */
const TABLES = {
  sources: "sources",
  ingredients: "ingredients",
  recipes: "recipes",
  recipeIngredients: "recipe_ingredients",
  pantryItems: "pantry_items",
} as const;

type LocalTable = keyof typeof TABLES;

/**
 * サーバーに無いローカル行のうち、**消してよい** id を返す（純粋関数）。
 *
 * 消してはいけないものが 2 種類ある:
 *   - **UUID でない id**: ローカル専用の行（`src-manual` 等）。サーバーには存在しえない
 *   - **送信キューに残っている id**: まだ送っていないローカルの追加・変更。サーバーの
 *     応答に無いのは当たり前で、消すと**オフラインで作ったレシピが消える**
 *
 * @param localIds - ローカルにある id（プル開始**前**に採る。取得中に増えた行を巻き込まない）
 * @param serverIds - サーバーから返ってきた id の集合（全ページ取得済みであること）
 * @param pendingIds - 送信キューに残っている id（取得の前後に採った和集合）
 *
 * @example
 * ```ts
 * idsToDelete(["a", "b"], new Set(["a"]), new Set()); // → ["b"]（b はサーバーで消えた）
 * ```
 */
export function idsToDelete(
  localIds: readonly string[],
  serverIds: ReadonlySet<string>,
  pendingIds: ReadonlySet<string>,
): string[] {
  return localIds.filter((id) => isUuid(id) && !serverIds.has(id) && !pendingIds.has(id));
}

/**
 * 上限（既定 1000 行）を跨いで全行を取る。
 *
 * **全件揃っていることが削除判定の前提**なので、1 ページで打ち切ってはいけない
 * （途中で切れた応答を「サーバーに無い」と解釈すると、ローカルの行を消してしまう）。
 * ページ間で行が重複・欠落しないよう id で並べる。
 */
async function fetchAll(table: string, columns = "*"): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`同期に失敗しました: ${error.message}`);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** 送信キューに残っている id。`deletes` は「こちらで消したがまだ送れていない」行。 */
interface PendingIds {
  all: Set<string>;
  deletes: Set<string>;
}

type PendingByTable = Map<string, PendingIds>;

/** 送信キューに残っている id をテーブル別に集める。 */
async function pendingByTable(): Promise<PendingByTable> {
  const result: PendingByTable = new Map();
  for (const entry of await db.outbox.toArray()) {
    const found = result.get(entry.table_name) ?? { all: new Set(), deletes: new Set() };
    found.all.add(entry.record_id);
    if (entry.op === "delete") found.deletes.add(entry.record_id);
    result.set(entry.table_name, found);
  }
  return result;
}

/** 2 つのスナップショットを合わせた「未送信かもしれない id」。 */
function unionPending(
  before: PendingByTable,
  after: PendingByTable,
  table: LocalTable,
  key: keyof PendingIds = "all",
): Set<string> {
  return new Set([...(before.get(table)?.[key] ?? []), ...(after.get(table)?.[key] ?? [])]);
}

/**
 * 送信前の削除を上書きで復活させないよう、プル結果から取り除く。
 *
 * オフラインでレシピを消すと、削除はキューに残ったままサーバーにはまだ届いていない。
 * その状態でプルすると、サーバーにはまだ在る行が upsert で**復活してしまう**。
 */
function withoutPendingDeletes(
  rows: Record<string, unknown>[],
  pendingDeletes: ReadonlySet<string>,
): Record<string, unknown>[] {
  if (pendingDeletes.size === 0) return rows;
  return rows.filter((row) => !pendingDeletes.has(row.id as string));
}

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
 * Supabase から自ユーザーのライブラリを取得し Dexie に反映する。
 *
 * RLS により自分の行のみ取得される。既存行は id で上書き（bulkPut）し、**サーバーに
 * 無くなった行は削除する**（{@link idsToDelete} が守る 2 条件に当てはまるものを除く）。
 *
 * 取得中に増えた行を巻き込まないよう、**ローカルの id と送信キューはプルの前に採る**。
 * 取得の後にもう一度キューを見て和を取るのは、取得中に「キューが流れて空になった」行を
 * 守るため（サーバーの応答はその行より前の時点のものかもしれない）。
 *
 * @returns 取り込んだレシピ件数
 */
export async function pullLibrary(): Promise<number> {
  if (!isSupabaseConfigured) return 0;

  // --- 取得前のスナップショット（削除判定の土台。順序に意味がある） ---
  const localIds = {
    sources: (await db.sources.toCollection().primaryKeys()) as string[],
    ingredients: (await db.ingredients.toCollection().primaryKeys()) as string[],
    recipes: (await db.recipes.toCollection().primaryKeys()) as string[],
    recipeIngredients: (await db.recipeIngredients.toCollection().primaryKeys()) as string[],
    pantryItems: (await db.pantryItems.toCollection().primaryKeys()) as string[],
  } satisfies Record<LocalTable, string[]>;
  const pendingBefore = await pendingByTable();

  const [sources, ingredients, recipes, lines, pantry] = await Promise.all([
    fetchAll(TABLES.sources),
    fetchAll(TABLES.ingredients),
    fetchAll(TABLES.recipes),
    fetchAll(TABLES.recipeIngredients),
    fetchAll(TABLES.pantryItems, "id, added_at"),
  ]);

  const pendingAfter = await pendingByTable();
  const serverIds = (rows: Record<string, unknown>[]) =>
    new Set(rows.map((r) => r.id as string));

  // 送信待ちの削除に当たる行は書き戻さない（消したものが復活しないように）。
  const keep = {
    sources: withoutPendingDeletes(
      sources,
      unionPending(pendingBefore, pendingAfter, "sources", "deletes"),
    ),
    ingredients: withoutPendingDeletes(
      ingredients,
      unionPending(pendingBefore, pendingAfter, "ingredients", "deletes"),
    ),
    recipes: withoutPendingDeletes(
      recipes,
      unionPending(pendingBefore, pendingAfter, "recipes", "deletes"),
    ),
    recipeIngredients: withoutPendingDeletes(
      lines,
      unionPending(pendingBefore, pendingAfter, "recipeIngredients", "deletes"),
    ),
    pantryItems: withoutPendingDeletes(
      pantry,
      unionPending(pendingBefore, pendingAfter, "pantryItems", "deletes"),
    ),
  } satisfies Record<LocalTable, Record<string, unknown>[]>;

  const doomed = {
    sources: idsToDelete(
      localIds.sources,
      serverIds(sources),
      unionPending(pendingBefore, pendingAfter, "sources"),
    ),
    ingredients: idsToDelete(
      localIds.ingredients,
      serverIds(ingredients),
      unionPending(pendingBefore, pendingAfter, "ingredients"),
    ),
    recipes: idsToDelete(
      localIds.recipes,
      serverIds(recipes),
      unionPending(pendingBefore, pendingAfter, "recipes"),
    ),
    recipeIngredients: idsToDelete(
      localIds.recipeIngredients,
      serverIds(lines),
      unionPending(pendingBefore, pendingAfter, "recipeIngredients"),
    ),
    pantryItems: idsToDelete(
      localIds.pantryItems,
      serverIds(pantry),
      unionPending(pendingBefore, pendingAfter, "pantryItems"),
    ),
  } satisfies Record<LocalTable, string[]>;

  await db.transaction(
    "rw",
    db.sources,
    db.ingredients,
    db.recipes,
    db.recipeIngredients,
    db.pantryItems,
    async () => {
      await db.sources.bulkPut(keep.sources as unknown as SourceRow[]);
      await db.ingredients.bulkPut(keep.ingredients as unknown as IngredientRow[]);
      await db.recipes.bulkPut(keep.recipes.map(toRecipeRow));
      await db.recipeIngredients.bulkPut(keep.recipeIngredients as unknown as RecipeIngredientRow[]);
      await db.pantryItems.bulkPut(keep.pantryItems as unknown as PantryItemRow[]);

      // 相手の端末での削除・食材マスタの統合をこちらにも反映する。
      // ここでの削除は「サーバーの状態を写している」だけなので outbox には積まない。
      await db.sources.bulkDelete(doomed.sources);
      await db.ingredients.bulkDelete(doomed.ingredients);
      await db.recipes.bulkDelete(doomed.recipes);
      await db.recipeIngredients.bulkDelete(doomed.recipeIngredients);
      await db.pantryItems.bulkDelete(doomed.pantryItems);
    },
  );

  return recipes.length;
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
