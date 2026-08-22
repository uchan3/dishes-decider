import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { IngredientCategory } from "@recipe-planner/core";
import { db } from "../db/schema.ts";
import { addToPantry, listPantry, removeFromPantry } from "../lib/pantry.ts";

const CATEGORY_LABEL: Record<string, string> = {
  vegetable: "野菜",
  meat: "肉",
  seafood: "魚",
  dairy_egg: "乳製品・卵",
  seasoning: "調味料",
  dry_goods: "乾物",
  frozen: "冷凍",
  other: "その他",
};

/**
 * 冷蔵庫（使い切りリスト）のパネル（docs/pantry.md）。
 *
 * 数量は持たない。買い物リストでチェックしたものが自動で入り、使い切ったら手で出す。
 */
export function PantryPanel() {
  const [query, setQuery] = useState("");
  const entries = useLiveQuery(() => listPantry(), []);
  const masters = useLiveQuery(() => db.ingredients.toArray(), [], []);

  const inPantry = useMemo(
    () => new Set((entries ?? []).map((entry) => entry.item.id)),
    [entries],
  );

  /** 追加候補: まだ入っていない食材を名前で絞り込む。 */
  const candidates = useMemo(() => {
    const key = query.trim();
    if (key === "") return [];
    return masters
      .filter((m) => !inPantry.has(m.id) && m.canonical_name.includes(key))
      .slice(0, 8);
  }, [masters, inPantry, query]);

  if (!entries) return <p className="muted">読み込み中…</p>;

  return (
    <section>
      <p className="muted">
        買い物リストでチェックしたものが自動で入ります。使い切ったら × で出してください。
      </p>

      <div className="pantry-add">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="食材を追加（名前で検索）"
          aria-label="冷蔵庫に追加する食材を検索"
        />
        {candidates.length > 0 && (
          <ul className="pantry-candidates">
            {candidates.map((m) => (
              <li key={m.id}>
                <button
                  className="btn"
                  onClick={() => {
                    void addToPantry(m.id);
                    setQuery("");
                  }}
                >
                  + {m.canonical_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          <p>冷蔵庫は空です。</p>
          <p className="muted">買い物リストでチェックすると、ここに入ります。</p>
        </div>
      ) : (
        <ul className="pantry-list">
          {entries.map(({ item, name, category }) => (
            <li key={item.id} className="pantry-row">
              <span className="pantry-row__name">{name ?? "（削除された食材）"}</span>
              <span className="pantry-row__meta">
                {CATEGORY_LABEL[category as IngredientCategory] ?? ""}
              </span>
              <button
                className="icon-btn"
                title="冷蔵庫から出す"
                aria-label={`${name ?? "この食材"} を冷蔵庫から出す`}
                onClick={() => void removeFromPantry(item.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
