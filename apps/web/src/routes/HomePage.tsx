import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type MealPlanRow } from "../db/schema.ts";
import { startOfWeek, today, weekdayLabel } from "../lib/date.ts";
import { generateWeek, type GeneratedWeek } from "../lib/planning.ts";

const ROLE_LABEL: Record<string, string> = {
  main: "主菜",
  side: "副菜",
  one_dish: "一皿",
  soup: "汁物",
  staple: "主食",
};

const RELAX_LABEL: Record<string, string> = {
  cook_time: "調理時間の上限",
  cooldown: "クールダウン",
  same_week_duplicate: "同一週の重複禁止",
};

/** 今週の献立画面。Dexie のレシピから core で献立を生成し表示する。 */
export function HomePage() {
  const weekStart = startOfWeek(today());
  const recipeCount = useLiveQuery(() => db.recipes.count(), [], -1);
  const titleById = useLiveQuery(async () => {
    const rows = await db.recipes.toArray();
    return new Map(rows.map((r) => [r.id, r.title] as const));
  }, []);
  const savedPlan = useLiveQuery(() => db.mealPlans.get(`plan-${weekStart}`), [weekStart]);

  const [result, setResult] = useState<GeneratedWeek | null>(null);
  const [generating, setGenerating] = useState(false);

  // 保存済みの献立があれば初期表示する。
  useEffect(() => {
    if (savedPlan && !result) {
      setResult({ plan: savedPlan, relaxations: [], unfilledCount: 0 });
    }
  }, [savedPlan, result]);

  const plan: MealPlanRow | undefined = result?.plan ?? savedPlan ?? undefined;

  async function handleGenerate() {
    setGenerating(true);
    try {
      setResult(await generateWeek(weekStart));
    } finally {
      setGenerating(false);
    }
  }

  if (recipeCount === -1) return <p className="muted">読み込み中…</p>;

  if (recipeCount === 0) {
    return (
      <section>
        <h1>今週の献立</h1>
        <div className="empty">
          <p>レシピがまだありません。</p>
          <p className="muted">
            <Link to="/settings">設定</Link> からサンプルデータを投入すると献立を生成できます。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <header className="page-head">
        <h1>今週の献立</h1>
        <button onClick={handleGenerate} disabled={generating} className="btn btn--primary">
          {generating ? "生成中…" : plan ? "作り直す" : "献立を生成"}
        </button>
      </header>
      <p className="muted">週開始: {weekStart}（レシピ {recipeCount} 件）</p>

      {result && result.relaxations.length > 0 && (
        <p className="notice">
          候補不足のため制約を緩和しました:{" "}
          {result.relaxations.map((r) => RELAX_LABEL[r] ?? r).join(" / ")}
        </p>
      )}
      {result && result.unfilledCount > 0 && (
        <p className="notice notice--warn">
          {result.unfilledCount} 枠は候補が見つからず未割当です。
        </p>
      )}

      {plan && (
        <>
          <div className="day-list">
            {plan.meals.map((meal) => (
              <article key={meal.id} className="day-card">
                <div className="day-card__date">
                  <span className="day-card__dow">{weekdayLabel(meal.date)}</span>
                  <span className="day-card__num">{meal.date.slice(5)}</span>
                </div>
                <ul className="slot-list">
                  {meal.slots.map((slot) => (
                    <li key={slot.id} className="slot">
                      <span className="slot__role">{ROLE_LABEL[slot.dish_role] ?? slot.dish_role}</span>
                      <span className="slot__recipe">
                        {slot.recipe_id
                          ? titleById?.get(slot.recipe_id) ?? slot.recipe_id
                          : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <Link to="/shopping" className="btn btn--block">
            買い物リストへ →
          </Link>
        </>
      )}
    </section>
  );
}
