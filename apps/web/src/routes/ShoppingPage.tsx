import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { IngredientCategory } from "@recipe-planner/core";
import { db, type ShoppingItemRow } from "../db/schema.ts";
import { startOfWeek, today } from "../lib/date.ts";
import {
  addManualItem,
  clearChecked,
  pantryIngredientIds,
  removeShoppingItem,
  setItemChecked,
  syncShoppingList,
} from "../lib/shopping.ts";
import { loadPlanningSettings } from "../lib/settings.ts";
import { pantryIngredientIdSet, removeFromPantry } from "../lib/pantry.ts";
import { PantryPanel } from "../components/PantryPanel.tsx";

const CATEGORY_META: Record<IngredientCategory, { icon: string; label: string }> = {
  vegetable: { icon: "🥬", label: "野菜" },
  meat: { icon: "🥩", label: "肉" },
  seafood: { icon: "🐟", label: "魚" },
  dairy_egg: { icon: "🥚", label: "乳製品・卵" },
  seasoning: { icon: "🧂", label: "調味料" },
  dry_goods: { icon: "🌾", label: "乾物" },
  frozen: { icon: "🧊", label: "冷凍" },
  other: { icon: "🧺", label: "その他" },
};

/**
 * 買い物リスト画面。今週の献立から集約した項目を Dexie に保存し、売場カテゴリ別に表示する。
 *
 * チェック状態は Dexie に永続化されるため、画面を離れても・オフラインでも保たれる（US-09）。
 */
export function ShoppingPage() {
  const weekStart = startOfWeek(today());
  const planId = `plan-${weekStart}`;
  const plan = useLiveQuery(() => db.mealPlans.get(planId), [planId]);

  /** 買うもの / 冷蔵庫 の切替（docs/pantry.md §8）。 */
  const [tab, setTab] = useState<"list" | "pantry">("list");
  const [includePantry, setIncludePantry] = useState(false);
  /** 「家にあるかも」を開いているか。 */
  const [showAtHome, setShowAtHome] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // 手動追加フォーム（US-13）。
  const [newName, setNewName] = useState("");
  const [newQuantity, setNewQuantity] = useState("");
  const [newUnit, setNewUnit] = useState("");

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    const quantity = newQuantity.trim() === "" ? null : Number(newQuantity);
    void addManualItem(planId, {
      displayName: newName,
      quantity: quantity !== null && Number.isFinite(quantity) ? quantity : null,
      unit: newUnit,
    });
    setNewName("");
    setNewQuantity("");
    setNewUnit("");
  }

  const householdSize = useLiveQuery(async () => (await loadPlanningSettings()).householdSize, []);

  // 献立か世帯人数が変わったら項目を組み立て直す（既存項目のチェックは引き継がれる）。
  const planRevision = plan?.updated_at;
  useEffect(() => {
    if (!plan || householdSize === undefined) return;
    let alive = true;
    setSyncing(true);
    void syncShoppingList(plan, householdSize).finally(() => {
      if (alive) setSyncing(false);
    });
    return () => {
      alive = false;
    };
    // plan の内容が変わったときだけ作り直す（liveQuery は同内容でも新しい参照を返すため）。
  }, [planId, planRevision, householdSize]);

  const items = useLiveQuery(async () => {
    const rows = await db.shoppingItems.where("meal_plan_id").equals(planId).toArray();
    return rows.sort((a, b) => a.position - b.position);
  }, [planId]);

  const pantryIds = useLiveQuery(() => pantryIngredientIds(), [], new Set<string>());
  /** 冷蔵庫に入っている食材（買い物リストでは「家にあるかも」に畳む）。 */
  const atHomeIds = useLiveQuery(() => pantryIngredientIdSet(), [], new Set<string>());

  const isPantry = (row: ShoppingItemRow): boolean =>
    row.ingredient_id !== null && pantryIds.has(row.ingredient_id);

  const isAtHome = (row: ShoppingItemRow): boolean =>
    row.ingredient_id !== null && atHomeIds.has(row.ingredient_id);

  /** 常備品を除いた表示対象。 */
  const shown = useMemo(
    () => (items ?? []).filter((row) => includePantry || !isPantry(row)),
    [items, includePantry, pantryIds],
  );

  /**
   * 家にある材料は畳む。完全には隠さない（買い忘れに気づけなくなるため）。
   *
   * ただし**チェック済みの項目は畳まない**。買い物中にチェックした瞬間、その品が
   * リストから消えて畳まれた中に移動するのは面食らうため（チェック＝冷蔵庫に入る）。
   * 次の週のリストでは未チェックに戻るので、そこで初めて「家にあるかも」に落ちる。
   */
  const foldable = (row: ShoppingItemRow): boolean => isAtHome(row) && !row.is_checked;
  const visible = useMemo(() => shown.filter((row) => !foldable(row)), [shown, atHomeIds]);
  const atHome = useMemo(() => shown.filter(foldable), [shown, atHomeIds]);

  const hiddenPantryCount = (items ?? []).length - shown.length;

  /** 献立が無いときに表示する手動追加分。 */
  const manualItems = (items ?? []).filter((row) => row.is_manual);

  /** 追加フォーム。献立の有無にかかわらず出す。 */
  const addForm = (
    <form className="add-item" onSubmit={handleAdd}>
      <h2 className="shop-group__head">買うものを追加</h2>
      <div className="add-item__row">
        <input
          className="add-item__name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="牛乳・トイレットペーパーなど"
          aria-label="品名"
        />
        <input
          className="add-item__qty"
          type="number"
          step="any"
          min="0"
          value={newQuantity}
          onChange={(e) => setNewQuantity(e.target.value)}
          placeholder="1"
          aria-label="数量"
        />
        <input
          className="add-item__unit"
          value={newUnit}
          onChange={(e) => setNewUnit(e.target.value)}
          placeholder="本"
          aria-label="単位"
        />
        <button type="submit" className="btn btn--primary" disabled={newName.trim() === ""}>
          追加
        </button>
      </div>
    </form>
  );

  const grouped = useMemo(() => {
    const map = new Map<IngredientCategory, ShoppingItemRow[]>();
    for (const row of visible) {
      const list = map.get(row.category) ?? [];
      list.push(row);
      map.set(row.category, list);
    }
    return map;
  }, [visible]);

  // 献立がまだ無くても、買い足したい品は登録できるようにする（US-13）。
  // 後で献立を作ると、手動項目を保ったまま材料が足される。
  if (!plan) {
    return (
      <section>
        <h1>買い物リスト</h1>
        <div className="empty">
          <p>今週の献立がまだありません。</p>
          <p className="muted">
            <Link to="/">献立</Link> を生成すると材料が追加されます。
          </p>
        </div>
        {manualItems.length > 0 && (
          <ul className="shop-list">
            {manualItems.map((row) => (
              <li
                key={row.id}
                className={row.is_checked ? "shop-item shop-item--done" : "shop-item"}
              >
                <label>
                  <input
                    type="checkbox"
                    checked={row.is_checked}
                    onChange={(e) => void setItemChecked(row.id, e.target.checked)}
                  />
                  <span className="shop-item__name">{row.display_name}</span>
                  <span className="shop-item__qty">
                    {row.quantity !== null && `${row.quantity}${row.unit ?? ""}`}
                  </span>
                </label>
                <button
                  className="icon-btn"
                  title="削除"
                  aria-label={`${row.display_name} を削除`}
                  onClick={() => void removeShoppingItem(row.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {addForm}
      </section>
    );
  }

  const doneCount = visible.filter((row) => row.is_checked).length;

  return (
    <section>
      <header className="page-head">
        <h1>買い物</h1>
        {tab === "list" && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={includePantry}
              onChange={(e) => setIncludePantry(e.target.checked)}
            />
            常備品も表示
          </label>
        )}
      </header>

      <div className="segmented">
        <button
          className={tab === "list" ? "segmented__btn segmented__btn--on" : "segmented__btn"}
          onClick={() => setTab("list")}
        >
          買うもの
        </button>
        <button
          className={tab === "pantry" ? "segmented__btn segmented__btn--on" : "segmented__btn"}
          onClick={() => setTab("pantry")}
        >
          冷蔵庫
        </button>
      </div>

      {tab === "pantry" && <PantryPanel />}
      {tab === "list" && (
      <>
      <p className="muted">
        {doneCount} / {visible.length} 完了
        {hiddenPantryCount > 0 && ` ・ 常備品 ${hiddenPantryCount} 件を非表示`}
        {syncing && " ・ 更新中…"}
      </p>
      {doneCount > 0 && (
        <button className="btn" onClick={() => void clearChecked(planId)}>
          チェックをすべて外す
        </button>
      )}

      {items !== undefined && visible.length === 0 && (
        <div className="empty">
          <p>買うものがありません。</p>
        </div>
      )}

      {[...grouped.entries()].map(([category, list]) => {
        const meta = CATEGORY_META[category];
        return (
          <div key={category} className="shop-group">
            <h2 className="shop-group__head">
              {meta.icon} {meta.label}
            </h2>
            <ul className="shop-list">
              {list.map((row) => (
                <li
                  key={row.id}
                  className={row.is_checked ? "shop-item shop-item--done" : "shop-item"}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={row.is_checked}
                      onChange={(e) => void setItemChecked(row.id, e.target.checked)}
                    />
                    <span className="shop-item__name">{row.display_name}</span>
                    <span className="shop-item__qty">
                      {row.quantity !== null && `${row.quantity}${row.unit ?? ""}`}
                      {row.ambiguous_note && (
                        <em className="shop-item__note"> {row.ambiguous_note}</em>
                      )}
                    </span>
                  </label>
                  {row.is_manual && (
                    <button
                      className="icon-btn"
                      title="削除"
                      aria-label={`${row.display_name} を削除`}
                      onClick={() => void removeShoppingItem(row.id)}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {atHome.length > 0 && (
        <div className="shop-group">
          <button className="at-home__head" onClick={() => setShowAtHome((v) => !v)}>
            {showAtHome ? "▾" : "▸"} 家にあるかも（{atHome.length}）
          </button>
          {showAtHome && (
            <ul className="shop-list">
              {atHome.map((row) => (
                <li key={row.id} className="shop-item shop-item--at-home">
                  <span className="shop-item__name">{row.display_name}</span>
                  <span className="shop-item__qty">
                    {row.quantity !== null && `${row.quantity}${row.unit ?? ""}`}
                  </span>
                  <button
                    className="btn"
                    onClick={() => {
                      if (row.ingredient_id) void removeFromPantry(row.ingredient_id);
                    }}
                  >
                    実は無い
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {addForm}
      </>
      )}
    </section>
  );
}
