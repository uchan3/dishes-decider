import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { db } from "../db/schema.ts";

const ROLE_LABEL: Record<string, string> = {
  main: "主菜",
  side: "副菜",
  one_dish: "一皿",
  soup: "汁物",
  staple: "主食",
};

/** レシピライブラリ画面。Dexie のレシピ一覧をライブ表示する。 */
export function LibraryPage() {
  const recipes = useLiveQuery(() => db.recipes.orderBy("title").toArray(), []);

  if (!recipes) return <p className="muted">読み込み中…</p>;

  if (recipes.length === 0) {
    return (
      <section>
        <h1>レシピ</h1>
        <div className="empty">
          <p>レシピがまだありません。</p>
          <p className="muted">
            <Link to="/settings">設定</Link> からサンプルデータを投入できます。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h1>レシピ（{recipes.length}）</h1>
      <ul className="recipe-list">
        {recipes.map((r) => (
          <li key={r.id} className="recipe-item">
            <div className="recipe-item__main">
              <span className="recipe-item__title">
                {r.is_favorite && "★ "}
                {r.title}
              </span>
              <span className="recipe-item__meta">
                {r.dish_roles.map((role) => ROLE_LABEL[role] ?? role).join("・")}
                {r.cook_time_min !== null && ` ・ ${r.cook_time_min}分`}
              </span>
            </div>
            {r.tags.length > 0 && (
              <div className="tags">
                {r.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
