import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { DishRole } from "@recipe-planner/core";
import { db } from "../db/schema.ts";
import { DEFAULT_RECIPE_FILTER, filterRecipes } from "../lib/recipeSearch.ts";

const ROLE_LABEL: Record<string, string> = {
  main: "主菜",
  side: "副菜",
  one_dish: "一皿完結",
  soup: "汁物",
  staple: "主食",
};

/**
 * 献立のスロットに入れるレシピを選ぶ（F-02-4「ライブラリから任意のレシピを直接指定」）。
 *
 * 既定ではそのスロットの役割で絞る（主菜の枠に副菜が並んでも選びにくい）が、
 * **外せるようにする**。「今日は一皿で済ませたい」のような意図を妨げないため。
 * 検索はライブラリと同じ `filterRecipes` を使うので、材料名でも引ける。
 *
 * @param role - スロットの役割（初期の絞り込みに使う）
 * @param onPick - 選ばれたレシピ ID
 * @param onClose - 閉じる
 */
export function RecipePicker({
  role,
  onPick,
  onClose,
}: {
  role: DishRole;
  onPick: (recipeId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [roleOnly, setRoleOnly] = useState(true);

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
    // 「もう出さないで」にしたレシピは選択肢に出さない（生成と同じ扱い）。
    return recipes
      .filter((recipe) => !recipe.is_excluded)
      .map((recipe) => ({
        recipe,
        ingredientNames: namesByRecipe.get(recipe.id) ?? [],
      }));
  }, []);

  const results = useMemo(() => {
    if (!entries) return [];
    return filterRecipes(entries, {
      ...DEFAULT_RECIPE_FILTER,
      query,
      role: roleOnly ? role : "all",
      sort: "title",
    });
  }, [entries, query, roleOnly, role]);

  return (
    <div className="picker">
      <div className="picker__head">
        <input
          className="picker__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="料理名・材料で検索"
          aria-label="レシピを検索"
          autoFocus
        />
        <button className="btn" onClick={onClose}>
          閉じる
        </button>
      </div>

      <label className="picker__filter">
        <input
          type="checkbox"
          checked={roleOnly}
          onChange={(e) => setRoleOnly(e.target.checked)}
        />
        {ROLE_LABEL[role] ?? role}だけ表示
      </label>

      {entries === undefined ? (
        <p className="muted">読み込み中…</p>
      ) : results.length === 0 ? (
        <p className="muted">該当するレシピがありません。</p>
      ) : (
        <ul className="picker__list">
          {results.slice(0, 50).map((recipe) => (
            <li key={recipe.id}>
              <button className="picker__item" onClick={() => onPick(recipe.id)}>
                <span className="picker__title">{recipe.title}</span>
                <span className="picker__meta">
                  {recipe.dish_roles.map((r) => ROLE_LABEL[r] ?? r).join("・")}
                  {recipe.cook_time_min !== null && ` · ${recipe.cook_time_min} 分`}
                  {recipe.is_favorite && " · ★"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {results.length > 50 && (
        <p className="muted">ほかにも {results.length - 50} 件あります。検索で絞ってください。</p>
      )}
    </div>
  );
}
