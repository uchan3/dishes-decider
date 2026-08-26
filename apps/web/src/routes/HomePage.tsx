import { useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema.ts";
import { startOfWeek, today, weekdayLabel } from "../lib/date.ts";
import {
  generateWeek,
  reshuffleMeal,
  reshuffleSlot,
  toggleSlotLock,
} from "../lib/planning.ts";
import { isSlotCooked, setSlotCooked } from "../lib/cooking.ts";
import { pantryUsedByRecipe, removeFromPantry, type PantryUsage } from "../lib/pantry.ts";

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

/** 「作った」直後に出す、冷蔵庫の消し込み候補（docs/pantry.md §4）。 */
interface CookedPrompt {
  recipeTitle: string;
  used: PantryUsage[];
  /** 外す対象（既定は全部）。 */
  checked: Set<string>;
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
  const [cookedPrompt, setCookedPrompt] = useState<CookedPrompt | null>(null);

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
    // 週の作り直しは常に現在の曜日テンプレで構造から生成する（ロックは generateWeek が維持）。
    void run(async () => {
      const result = await generateWeek(weekStart);
      return { relaxations: result.relaxations, unfilled: result.unfilledCount, noAlternative: 0 };
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

  /**
   * 「作った」を記録／取り消しする。レシピの調理回数・最終調理日に反映される。
   * 記録したときは、冷蔵庫から出す候補を提示する（自動では消さない）。
   */
  function handleCooked(slotId: string, cooked: boolean) {
    if (!plan) return;
    void run(async () => {
      await setSlotCooked(plan, slotId, cooked);
      if (!cooked) {
        setCookedPrompt(null);
        return;
      }
      const recipeId = plan.meals
        .flatMap((m) => m.slots)
        .find((s) => s.id === slotId)?.recipe_id;
      if (!recipeId) return;
      const used = await pantryUsedByRecipe(recipeId);
      if (used.length === 0) return;
      setCookedPrompt({
        recipeTitle: titleById?.get(recipeId) ?? "この料理",
        used,
        checked: new Set(used.map((u) => u.ingredientId)),
      });
    });
  }

  /** 提示した候補のうち、チェックが残っているものを冷蔵庫から出す。 */
  function confirmCookedPrompt() {
    const prompt = cookedPrompt;
    if (!prompt) return;
    setCookedPrompt(null);
    void Promise.all([...prompt.checked].map((id) => removeFromPantry(id)));
  }

  if (recipeCount === -1) return <p className="muted">読み込み中…</p>;

  if (recipeCount === 0) {
    return (
      <section>
        <h1>今週の献立</h1>
        <div className="empty">
          <p>レシピがまだありません。</p>
          <p className="muted">
            <Link to="/add">レシピを追加</Link> から登録するか、iOS
            ショートカットで取り込むと献立を生成できます。
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

      {cookedPrompt && (
        <div className="notice cooked-prompt">
          <p>
            <strong>{cookedPrompt.recipeTitle}</strong> を作りました。使い切ったものを冷蔵庫から出しますか？
          </p>
          <ul className="cooked-prompt__list">
            {cookedPrompt.used.map((u) => (
              <li key={u.ingredientId}>
                <label>
                  <input
                    type="checkbox"
                    checked={cookedPrompt.checked.has(u.ingredientId)}
                    onChange={(e) =>
                      setCookedPrompt((prev) => {
                        if (!prev) return prev;
                        const checked = new Set(prev.checked);
                        if (e.target.checked) checked.add(u.ingredientId);
                        else checked.delete(u.ingredientId);
                        return { ...prev, checked };
                      })
                    }
                  />
                  {u.name}
                </label>
              </li>
            ))}
          </ul>
          <div className="btn-row">
            <button className="btn btn--primary" onClick={confirmCookedPrompt}>
              冷蔵庫から出す（{cookedPrompt.checked.size}）
            </button>
            <button className="btn" onClick={() => setCookedPrompt(null)}>
              そのままにする
            </button>
          </div>
        </div>
      )}

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
                  {!meal.is_skipped && meal.slots.length > 0 && (
                    <button
                      className="icon-btn"
                      title="この日を作り直す"
                      disabled={busy}
                      onClick={() => handleMeal(meal.id)}
                    >
                      ↻
                    </button>
                  )}
                </div>
                {meal.is_skipped ? (
                  <p className="slot-list slot--skipped muted">外食・作らない</p>
                ) : (
                <ul className="slot-list">
                  {meal.slots.map((slot) => {
                    const cooked = isSlotCooked(slot.cooked_at);
                    const classes = ["slot"];
                    if (slot.is_locked) classes.push("slot--locked");
                    if (cooked) classes.push("slot--cooked");
                    return (
                    <li key={slot.id} className={classes.join(" ")}>
                      <span className="slot__role">{ROLE_LABEL[slot.dish_role] ?? slot.dish_role}</span>
                      <span className="slot__recipe">
                        {slot.recipe_id ? (
                          <Link to={`/recipe/${slot.recipe_id}`} className="slot__link">
                            {titleById?.get(slot.recipe_id) ?? slot.recipe_id}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </span>
                      <span className="slot__actions">
                        <button
                          className={cooked ? "icon-btn icon-btn--on" : "icon-btn"}
                          title={cooked ? "作った記録を取り消す" : "作った"}
                          disabled={busy || slot.recipe_id === null}
                          onClick={() => handleCooked(slot.id, !cooked)}
                        >
                          {cooked ? "✅" : "🍳"}
                        </button>
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
                          title={cooked ? "作った料理は変更できません" : "別のレシピにする"}
                          disabled={busy || slot.is_locked || cooked}
                          onClick={() => handleSlot(slot.id)}
                        >
                          ↻
                        </button>
                      </span>
                    </li>
                    );
                  })}
                </ul>
                )}
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
