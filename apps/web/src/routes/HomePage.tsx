import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema.ts";
import { startOfWeek, today, weekdayLabel } from "../lib/date.ts";
import {
  generateWeek,
  reshuffleMeal,
  reshuffleSlot,
  reshuffleWeek,
  toggleSlotLock,
} from "../lib/planning.ts";

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

interface Notice {
  relaxations: string[];
  unfilled: number;
  noAlternative: number;
}

/** 今週の献立画面。生成・スロット再抽選・ロック・日/週単位の作り直しを扱う（US-05/06）。 */
export function HomePage() {
  const weekStart = startOfWeek(today());
  const recipeCount = useLiveQuery(() => db.recipes.count(), [], -1);
  const titleById = useLiveQuery(async () => {
    const rows = await db.recipes.toArray();
    return new Map(rows.map((r) => [r.id, r.title] as const));
  }, []);
  const plan = useLiveQuery(() => db.mealPlans.get(`plan-${weekStart}`), [weekStart]);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  /** 非同期アクションを busy 管理で包む。plan 更新は useLiveQuery が拾う。 */
  async function run(action: () => Promise<Notice | void>) {
    setBusy(true);
    try {
      const result = await action();
      if (result) setNotice(result);
    } finally {
      setBusy(false);
    }
  }

  function handleWeek() {
    void run(async () => {
      const result = plan
        ? await reshuffleWeek(plan)
        : { ...(await generateWeek(weekStart)), noAlternativeCount: 0 };
      return {
        relaxations: result.relaxations,
        unfilled: result.unfilledCount,
        noAlternative: result.noAlternativeCount,
      };
    });
  }

  function handleSlot(slotId: string) {
    if (!plan) return;
    void run(async () => {
      const r = await reshuffleSlot(plan, slotId);
      return { relaxations: r.relaxations, unfilled: r.unfilledCount, noAlternative: r.noAlternativeCount };
    });
  }

  function handleMeal(mealId: string) {
    if (!plan) return;
    void run(async () => {
      const r = await reshuffleMeal(plan, mealId);
      return { relaxations: r.relaxations, unfilled: r.unfilledCount, noAlternative: r.noAlternativeCount };
    });
  }

  function handleLock(slotId: string) {
    if (!plan) return;
    void run(async () => {
      await toggleSlotLock(plan, slotId);
    });
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
        <button onClick={handleWeek} disabled={busy} className="btn btn--primary">
          {busy ? "処理中…" : plan ? "作り直す" : "献立を生成"}
        </button>
      </header>
      <p className="muted">週開始: {weekStart}（レシピ {recipeCount} 件）</p>

      {notice && notice.relaxations.length > 0 && (
        <p className="notice">
          候補不足のため制約を緩和しました:{" "}
          {notice.relaxations.map((r) => RELAX_LABEL[r] ?? r).join(" / ")}
        </p>
      )}
      {notice && notice.unfilled > 0 && (
        <p className="notice notice--warn">{notice.unfilled} 枠は候補が見つからず未割当です。</p>
      )}
      {notice && notice.noAlternative > 0 && (
        <p className="notice notice--warn">
          他に候補がないため {notice.noAlternative} 枠はそのままにしました。
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
                  <button
                    className="icon-btn"
                    title="この日を作り直す"
                    disabled={busy}
                    onClick={() => handleMeal(meal.id)}
                  >
                    ↻
                  </button>
                </div>
                <ul className="slot-list">
                  {meal.slots.map((slot) => (
                    <li key={slot.id} className={slot.is_locked ? "slot slot--locked" : "slot"}>
                      <span className="slot__role">{ROLE_LABEL[slot.dish_role] ?? slot.dish_role}</span>
                      <span className="slot__recipe">
                        {slot.recipe_id ? titleById?.get(slot.recipe_id) ?? slot.recipe_id : "—"}
                      </span>
                      <span className="slot__actions">
                        <button
                          className={slot.is_locked ? "icon-btn icon-btn--on" : "icon-btn"}
                          title={slot.is_locked ? "ロック解除" : "ロック"}
                          disabled={busy}
                          onClick={() => handleLock(slot.id)}
                        >
                          {slot.is_locked ? "🔒" : "🔓"}
                        </button>
                        <button
                          className="icon-btn"
                          title="別のレシピにする"
                          disabled={busy || slot.is_locked}
                          onClick={() => handleSlot(slot.id)}
                        >
                          ↻
                        </button>
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
