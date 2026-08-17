import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import type { DishRole } from "@recipe-planner/core";
import { db } from "../db/schema.ts";
import {
  DEFAULT_RECIPE_FILTER,
  filterRecipes,
  type RecipeSearchEntry,
  type RecipeSort,
} from "../lib/recipeSearch.ts";

const ROLE_LABEL: Record<string, string> = {
  main: "主菜",
  side: "副菜",
  one_dish: "一皿",
  soup: "汁物",
  staple: "主食",
};

const ROLE_OPTIONS: { value: DishRole | "all"; label: string }[] = [
  { value: "all", label: "すべての役割" },
  { value: "main", label: "主菜" },
  { value: "side", label: "副菜" },
  { value: "one_dish", label: "一皿完結" },
  { value: "soup", label: "汁物" },
  { value: "staple", label: "主食" },
];

/** 調理時間の絞り込み（分）。null = 指定なし。 */
const COOK_TIME_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "調理時間すべて" },
  { value: 15, label: "15分以内" },
  { value: 30, label: "30分以内" },
  { value: 60, label: "60分以内" },
];

const SORT_OPTIONS: { value: RecipeSort; label: string }[] = [
  { value: "recent", label: "追加が新しい順" },
  { value: "last_cooked", label: "最近作った順" },
  { value: "cook_count", label: "よく作る順" },
  { value: "title", label: "名前順" },
];

/** レシピライブラリ画面（F-01-3）。検索・絞り込み・並べ替えに対応する。 */
export function LibraryPage() {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<DishRole | "all">("all");
  const [sourceId, setSourceId] = useState<string | "all">("all");
  const [maxCookMin, setMaxCookMin] = useState<number | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<RecipeSort>(DEFAULT_RECIPE_FILTER.sort);

  const sources = useLiveQuery(() => db.sources.toArray(), [], []);

  // 検索は材料名も対象にするため、レシピと材料を突き合わせた索引を作る。
  const entries = useLiveQuery(async () => {
    const [recipes, lines] = await Promise.all([
      db.recipes.toArray(),
      db.recipeIngredients.toArray(),
    ]);
    const namesByRecipe = new Map<string, string[]>();
    for (const line of lines) {
      const list = namesByRecipe.get(line.recipe_id) ?? [];
      list.push(line.display_name);
      namesByRecipe.set(line.recipe_id, list);
    }
    return recipes.map<RecipeSearchEntry>((recipe) => ({
      recipe,
      ingredientNames: namesByRecipe.get(recipe.id) ?? [],
    }));
  }, []);

  const recipes = useMemo(
    () => filterRecipes(entries ?? [], { query, role, sourceId, maxCookMin, favoritesOnly, sort }),
    [entries, query, role, sourceId, maxCookMin, favoritesOnly, sort],
  );

  if (!entries) return <p className="muted">読み込み中…</p>;

  if (entries.length === 0) {
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

      <div className="filters">
        <input
          className="filters__search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="料理名・材料・タグで検索"
          aria-label="レシピを検索"
        />
        <div className="filters__row">
          <select value={role} onChange={(e) => setRole(e.target.value as DishRole | "all")}>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="all">すべてのソース</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
          <select
            value={maxCookMin ?? ""}
            onChange={(e) => setMaxCookMin(e.target.value === "" ? null : Number(e.target.value))}
          >
            {COOK_TIME_OPTIONS.map((o) => (
              <option key={o.label} value={o.value ?? ""}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as RecipeSort)}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <label className="toggle">
            <input
              type="checkbox"
              checked={favoritesOnly}
              onChange={(e) => setFavoritesOnly(e.target.checked)}
            />
            お気に入り
          </label>
        </div>
      </div>

      {recipes.length === 0 ? (
        <div className="empty">
          <p>条件に合うレシピがありません。</p>
        </div>
      ) : (
        <ul className="recipe-list">
          {recipes.map((r) => (
            <li key={r.id}>
              <Link to={`/recipe/${r.id}`} className="recipe-item">
                <div className="recipe-item__main">
                  <span className="recipe-item__title">
                    {r.is_favorite && "★ "}
                    {r.title}
                    {r.is_excluded && <span className="recipe-item__excluded"> 除外中</span>}
                  </span>
                  <span className="recipe-item__meta">
                    {r.dish_roles.map((role) => ROLE_LABEL[role] ?? role).join("・")}
                    {r.cook_time_min !== null && ` ・ ${r.cook_time_min}分`}
                    {r.cook_count > 0 && ` ・ ${r.cook_count}回`}
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
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
