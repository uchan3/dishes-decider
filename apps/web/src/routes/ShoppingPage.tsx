import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { IngredientCategory, ShoppingItem } from "@recipe-planner/core";
import { db } from "../db/schema.ts";
import { startOfWeek, today } from "../lib/date.ts";
import { buildShoppingItems } from "../lib/planning.ts";

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

const HOUSEHOLD_SIZE = 2;

/** 買い物リスト画面。今週の献立から材料を集約し、売場カテゴリ別に表示する。 */
export function ShoppingPage() {
  const weekStart = startOfWeek(today());
  const plan = useLiveQuery(() => db.mealPlans.get(`plan-${weekStart}`), [weekStart]);

  const [includePantry, setIncludePantry] = useState(false);
  const [items, setItems] = useState<ShoppingItem[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!plan) {
      setItems(null);
      return;
    }
    let alive = true;
    buildShoppingItems(plan, HOUSEHOLD_SIZE, includePantry).then((result) => {
      if (alive) setItems(result);
    });
    return () => {
      alive = false;
    };
  }, [plan, includePantry]);

  const grouped = useMemo(() => {
    const map = new Map<IngredientCategory, ShoppingItem[]>();
    for (const item of items ?? []) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return map;
  }, [items]);

  function keyOf(item: ShoppingItem): string {
    return item.ingredientId ?? item.displayName;
  }

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (!plan) {
    return (
      <section>
        <h1>買い物リスト</h1>
        <div className="empty">
          <p>今週の献立がまだありません。</p>
          <p className="muted">
            <Link to="/">献立</Link> を生成すると買い物リストが作られます。
          </p>
        </div>
      </section>
    );
  }

  const total = items?.length ?? 0;
  const doneCount = [...checked].length;

  return (
    <section>
      <header className="page-head">
        <h1>買い物リスト</h1>
        <label className="toggle">
          <input
            type="checkbox"
            checked={includePantry}
            onChange={(e) => setIncludePantry(e.target.checked)}
          />
          常備品も表示
        </label>
      </header>
      <p className="muted">
        {doneCount} / {total} 完了
      </p>

      {[...grouped.entries()].map(([category, list]) => {
        const meta = CATEGORY_META[category];
        return (
          <div key={category} className="shop-group">
            <h2 className="shop-group__head">
              {meta.icon} {meta.label}
            </h2>
            <ul className="shop-list">
              {list.map((item) => {
                const key = keyOf(item);
                const isChecked = checked.has(key);
                return (
                  <li key={key} className={isChecked ? "shop-item shop-item--done" : "shop-item"}>
                    <label>
                      <input type="checkbox" checked={isChecked} onChange={() => toggle(key)} />
                      <span className="shop-item__name">{item.displayName}</span>
                      <span className="shop-item__qty">
                        {item.quantity !== null && `${item.quantity}${item.unit ?? ""}`}
                        {item.ambiguousNote && (
                          <em className="shop-item__note"> {item.ambiguousNote}</em>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
