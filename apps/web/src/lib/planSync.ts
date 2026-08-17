/**
 * 献立・買い物リストの端末間同期（US-14 / architecture §5）。
 *
 * 献立生成も買い物リストの集約もクライアント side で完結するため、サーバーが中身を読む
 * 場面が無い。そこで正規化テーブルに展開せず、**クライアントの入れ子ドキュメントを
 * 1 週 1 行にそのまま保存する**（`meal_plans.doc` / `shopping_lists.doc`）。
 *
 * 競合解決:
 *   - **献立** はドキュメント単位の Last-Write-Wins。1 台で作り直している最中に相手が
 *     触ることは実質ない
 *   - **買い物リスト** は項目単位でマージする。二人で同じ店に居て、それぞれの端末で別々の
 *     項目にチェックを付ける、というのがまさに起きるため（丸ごと LWW だと片方が消える）
 */

import { supabase, isSupabaseConfigured } from "./supabase.ts";
import { db, type MealPlanRow, type ShoppingItemRow } from "../db/schema.ts";

/** 同期する 1 週間ぶんのドキュメント。 */
export interface PlanDocument {
  /** 週開始日 (YYYY-MM-DD)。Supabase 側の一意キー。 */
  startDate: string;
  /** 献立本体（Dexie の行そのまま）。 */
  plan: MealPlanRow;
  /** その週の買い物リスト項目。 */
  items: ShoppingItemRow[];
  /** 買い物リストの更新時刻（項目単位の時刻が無い場合のフォールバック）。 */
  itemsUpdatedAt: string;
}

/** 週ドキュメントを Dexie から組み立てる。献立が無ければ null。 */
export async function buildPlanDocument(planId: string): Promise<PlanDocument | null> {
  const plan = await db.mealPlans.get(planId);
  if (!plan) return null;
  const items = await db.shoppingItems.where("meal_plan_id").equals(planId).toArray();
  const itemsUpdatedAt = items.reduce<string>(
    (latest, item) => (item.updated_at && item.updated_at > latest ? item.updated_at : latest),
    plan.updated_at,
  );
  return { startDate: plan.start_date, plan, items, itemsUpdatedAt };
}

/** ISO 文字列の新しさ比較。`null`/`undefined` は最も古いものとして扱う。 */
function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  return a > b;
}

/**
 * 買い物リストの項目をマージする（純粋関数）。
 *
 * - **どの項目が存在するか**は新しい方のドキュメントに従う（削除や献立の作り直しを反映するため）
 * - **チェック状態**は項目ごとに新しい方を採用する（二人が別々の項目にチェックしても消えない）
 *
 * @param local - 手元の項目
 * @param remote - 受信した項目
 * @param localUpdatedAt - 手元のドキュメント時刻
 * @param remoteUpdatedAt - 受信したドキュメント時刻
 */
export function mergeShoppingItems(
  local: readonly ShoppingItemRow[],
  remote: readonly ShoppingItemRow[],
  localUpdatedAt: string,
  remoteUpdatedAt: string,
): ShoppingItemRow[] {
  const remoteWins = isNewer(remoteUpdatedAt, localUpdatedAt);
  const base = remoteWins ? remote : local;
  const other = new Map((remoteWins ? local : remote).map((item) => [item.id, item] as const));

  return base.map((item) => {
    const counterpart = other.get(item.id);
    if (!counterpart) return item;
    // 項目ごとの時刻が無い場合はドキュメントの時刻で代用する。
    const itemTime = item.updated_at ?? (remoteWins ? remoteUpdatedAt : localUpdatedAt);
    const otherTime = counterpart.updated_at ?? (remoteWins ? localUpdatedAt : remoteUpdatedAt);
    if (!isNewer(otherTime, itemTime)) return item;
    return { ...item, is_checked: counterpart.is_checked, updated_at: otherTime };
  });
}

/** 受信したドキュメントを Dexie に取り込むべきか（献立はドキュメント単位の LWW）。 */
export function shouldApplyPlan(local: MealPlanRow | undefined, remote: MealPlanRow): boolean {
  if (!local) return true;
  return isNewer(remote.updated_at, local.updated_at);
}

/**
 * 受信したドキュメントを Dexie に反映する。
 *
 * 献立は新しい方で置き換え、買い物リストは {@link mergeShoppingItems} でマージする。
 *
 * @returns 反映したら true（何も変えなければ false）
 */
export async function applyPlanDocument(remote: PlanDocument): Promise<boolean> {
  const planId = remote.plan.id;
  const [localPlan, localItems] = await Promise.all([
    db.mealPlans.get(planId),
    db.shoppingItems.where("meal_plan_id").equals(planId).toArray(),
  ]);

  const applyPlan = shouldApplyPlan(localPlan, remote.plan);
  const localItemsUpdatedAt = localItems.reduce<string>(
    (latest, item) => (item.updated_at && item.updated_at > latest ? item.updated_at : latest),
    localPlan?.updated_at ?? "",
  );
  const merged = mergeShoppingItems(
    localItems,
    remote.items,
    localItemsUpdatedAt,
    remote.itemsUpdatedAt,
  );

  const itemsChanged = JSON.stringify(merged) !== JSON.stringify(localItems);
  if (!applyPlan && !itemsChanged) return false;

  await db.transaction("rw", db.mealPlans, db.shoppingItems, async () => {
    if (applyPlan) await db.mealPlans.put(remote.plan);
    if (itemsChanged) {
      const keep = new Set(merged.map((item) => item.id));
      const removed = localItems.filter((item) => !keep.has(item.id)).map((item) => item.id);
      if (removed.length > 0) await db.shoppingItems.bulkDelete(removed);
      if (merged.length > 0) await db.shoppingItems.bulkPut(merged);
    }
  });
  return true;
}

/** 週ドキュメントを Supabase に送る（1 週 = meal_plans 1 行 + shopping_lists 1 行）。 */
export async function pushPlanDocument(userId: string, doc: PlanDocument): Promise<void> {
  const { data, error } = await supabase
    .from("meal_plans")
    .upsert(
      {
        user_id: userId,
        start_date: doc.startDate,
        status: doc.plan.status,
        doc: { plan: doc.plan, itemsUpdatedAt: doc.itemsUpdatedAt },
      },
      { onConflict: "user_id,start_date" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`献立の送信に失敗: ${error.message}`);

  const { error: listErr } = await supabase.from("shopping_lists").upsert(
    { meal_plan_id: data.id as string, doc: { items: doc.items } },
    { onConflict: "meal_plan_id" },
  );
  if (listErr) throw new Error(`買い物リストの送信に失敗: ${listErr.message}`);
}

/** Supabase 行（doc 付き）を {@link PlanDocument} に戻す。壊れていれば null。 */
function toDocument(row: Record<string, unknown>): PlanDocument | null {
  const planDoc = row.doc as { plan?: MealPlanRow; itemsUpdatedAt?: string } | null;
  if (!planDoc?.plan) return null;
  const lists = row.shopping_lists as { doc?: { items?: ShoppingItemRow[] } }[] | null;
  return {
    startDate: row.start_date as string,
    plan: planDoc.plan,
    items: lists?.[0]?.doc?.items ?? [],
    itemsUpdatedAt: planDoc.itemsUpdatedAt ?? planDoc.plan.updated_at,
  };
}

/**
 * Supabase から週ドキュメントを取得して Dexie に反映する。
 *
 * @param limit - 取得する週数（新しい順）。買い物は今週・来週しか見ないので既定は 4
 * @returns 反映した週の数
 */
export async function pullPlans(limit = 4): Promise<number> {
  if (!isSupabaseConfigured) return 0;
  const { data, error } = await supabase
    .from("meal_plans")
    .select("id, start_date, status, doc, shopping_lists(doc)")
    .order("start_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`献立の取得に失敗しました: ${error.message}`);

  let applied = 0;
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const doc = toDocument(row);
    if (doc && (await applyPlanDocument(doc))) applied++;
  }
  return applied;
}

/**
 * 相手の端末での変更を購読する（買い物中のチェックが手元にも反映される）。
 *
 * @param onChange - 反映後に呼ばれる（反映した週数）
 * @returns 購読解除関数
 */
export function subscribePlans(onChange?: (applied: number) => void): () => void {
  if (!isSupabaseConfigured) return () => {};

  const channel = supabase
    .channel("plan_sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "meal_plans" }, async () => {
      onChange?.(await pullPlans());
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "shopping_lists" }, async () => {
      onChange?.(await pullPlans());
    })
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
