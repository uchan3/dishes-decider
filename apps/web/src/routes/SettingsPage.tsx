import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { IngredientCategory } from "@recipe-planner/core";
import { db } from "../db/schema.ts";
import { seedSampleData } from "../db/seed.ts";
import {
  TEMPLATES,
  WEEKDAY_LABELS,
  type TemplateId,
  type WeekdayTemplates,
} from "../lib/mealTemplates.ts";
import {
  loadPlanningSettings,
  loadWeekdayTemplates,
  savePlanningSettings,
  saveWeekdayTemplates,
  type PlanningSettings,
} from "../lib/settings.ts";
import { setPantryStaple } from "../lib/ingredients.ts";
import { useAuth } from "../lib/auth.tsx";
import { pullLibrary } from "../lib/sync.ts";
import { relinkIngredients } from "../lib/relink.ts";
import { setSourceEnabled } from "../lib/sources.ts";
import { IngestCard } from "../components/IngestCard.tsx";

/** 売場カテゴリの並び順とラベル（買い物リストの導線順に合わせる）。 */
const CATEGORY_ORDER: IngredientCategory[] = [
  "vegetable",
  "meat",
  "seafood",
  "dairy_egg",
  "seasoning",
  "dry_goods",
  "frozen",
  "other",
];

const CATEGORY_LABEL: Record<IngredientCategory, string> = {
  vegetable: "野菜",
  meat: "肉",
  seafood: "魚",
  dairy_egg: "乳製品・卵",
  seasoning: "調味料",
  dry_goods: "乾物",
  frozen: "冷凍",
  other: "その他",
};

const KIND_LABEL: Record<string, string> = {
  youtube: "YouTube",
  instagram: "Instagram",
  web: "Web",
  manual: "手動入力",
};

/** 設定画面。ソース管理（生成対象トグル）と開発用データ操作。 */
export function SettingsPage() {
  const recipeCount = useLiveQuery(() => db.recipes.count(), [], 0);
  const sources = useLiveQuery(() => db.sources.toArray(), []);
  const countBySource = useLiveQuery(async () => {
    const rows = await db.recipes.toArray();
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = r.source_id ?? "";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, []);

  const weekdayTemplates = useLiveQuery(() => loadWeekdayTemplates(), []);
  const planning = useLiveQuery(() => loadPlanningSettings(), []);
  // 常備品の編集用。売場カテゴリ順 → 名前順で並べる。
  const masters = useLiveQuery(async () => {
    const rows = await db.ingredients.toArray();
    return rows.sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        a.canonical_name.localeCompare(b.canonical_name, "ja"),
    );
  }, []);
  const { configured, session, userId, signOut } = useAuth();

  /** 食材マスタに紐付いていない材料の数（再照合の要否を示す）。 */
  const unlinkedCount = useLiveQuery(async () => {
    const lines = await db.recipeIngredients.toArray();
    return lines.filter((l) => l.ingredient_id === null).length;
  }, []);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setBusy(true);
    try {
      const n = await pullLibrary();
      setMessage(`同期しました（レシピ ${n} 件）。`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "同期に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function handleRelink() {
    setBusy(true);
    try {
      const r = await relinkIngredients(userId);
      setMessage(
        r.scanned === 0
          ? "未紐付けの材料はありませんでした。"
          : `${r.linked} 件の材料を紐付けました（新規食材 ${r.created} 件` +
            `${r.synced ? "・Supabase にも反映" : ""}）。`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "再照合に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  /** 生成設定を 1 項目だけ更新して保存する（保存時に正規化される）。 */
  function updatePlanning(patch: Partial<PlanningSettings>) {
    if (!planning) return;
    void savePlanningSettings({ ...planning, ...patch });
  }

  /** 常備品フラグを切り替える。買い物リストの既定表示から外れる（US-10）。 */
  function togglePantry(id: string, next: boolean) {
    void setPantryStaple(id, next).catch((e: unknown) => {
      setMessage(e instanceof Error ? e.message : "食材の更新に失敗しました");
    });
  }

  function setWeekdayTemplate(index: number, templateId: TemplateId) {
    if (!weekdayTemplates) return;
    const next = [...weekdayTemplates] as WeekdayTemplates;
    next[index] = templateId;
    void saveWeekdayTemplates(next);
  }

  async function handleSeed() {
    setBusy(true);
    try {
      const n = await seedSampleData();
      setMessage(`サンプルレシピ ${n} 件を投入しました。`);
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setBusy(true);
    try {
      await Promise.all([
        db.sources.clear(),
        db.ingredients.clear(),
        db.recipes.clear(),
        db.recipeIngredients.clear(),
        db.mealPlans.clear(),
        db.shoppingItems.clear(),
      ]);
      setMessage("全データを消去しました。");
    } finally {
      setBusy(false);
    }
  }

  function toggleSource(id: string, next: boolean) {
    // Dexie だけ更新すると次回の同期で巻き戻るため、Supabase にも書く。
    void setSourceEnabled(id, next).catch((e: unknown) => {
      setMessage(e instanceof Error ? e.message : "ソースの更新に失敗しました");
    });
  }

  return (
    <section>
      <h1>設定</h1>

      {configured && (
        <div className="card">
          <h2>アカウント</h2>
          <p className="muted">{session?.user.email ?? "サインイン中"}</p>
          <div className="btn-row">
            <button onClick={handleSync} disabled={busy} className="btn btn--primary">
              今すぐ同期
            </button>
            <button onClick={() => void signOut()} disabled={busy} className="btn">
              サインアウト
            </button>
          </div>
          <p className="muted">
            取り込んだレシピは自動で同期されます（取り込み完了時に反映）。
          </p>
        </div>
      )}

      {configured && userId && <IngestCard userId={userId} />}

      <div className="card">
        <h2>献立の生成設定</h2>
        <p className="muted">次回の生成・再抽選から反映されます。</p>
        {!planning ? (
          <p className="muted">読み込み中…</p>
        ) : (
          <ul className="setting-list">
            <li className="setting-item">
              <label htmlFor="household-size">世帯人数</label>
              <span className="setting-item__control">
                <input
                  id="household-size"
                  type="number"
                  min={1}
                  max={12}
                  value={planning.householdSize}
                  onChange={(e) => updatePlanning({ householdSize: Number(e.target.value) })}
                />
                <span className="muted">人</span>
              </span>
            </li>
            <li className="setting-item">
              <label htmlFor="cooldown-days">クールダウン</label>
              <span className="setting-item__control">
                <input
                  id="cooldown-days"
                  type="number"
                  min={0}
                  max={365}
                  value={planning.cooldownDays}
                  onChange={(e) => updatePlanning({ cooldownDays: Number(e.target.value) })}
                />
                <span className="muted">日以内に作った料理は出さない</span>
              </span>
            </li>
            <li className="setting-item">
              <label htmlFor="weekday-max">平日の調理時間</label>
              <span className="setting-item__control">
                <input
                  id="weekday-max"
                  type="number"
                  min={1}
                  max={600}
                  placeholder="制限なし"
                  value={planning.weekdayMaxCookMin ?? ""}
                  onChange={(e) =>
                    updatePlanning({
                      weekdayMaxCookMin: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                <span className="muted">分以内（空欄で制限なし）</span>
              </span>
            </li>
            <li className="setting-item">
              <label htmlFor="weekend-max">休日の調理時間</label>
              <span className="setting-item__control">
                <input
                  id="weekend-max"
                  type="number"
                  min={1}
                  max={600}
                  placeholder="制限なし"
                  value={planning.weekendMaxCookMin ?? ""}
                  onChange={(e) =>
                    updatePlanning({
                      weekendMaxCookMin: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
                <span className="muted">分以内（空欄で制限なし）</span>
              </span>
            </li>
          </ul>
        )}
      </div>

      <div className="card">
        <h2>曜日ごとの献立構成</h2>
        <p className="muted">各曜日にどの構成で献立を作るか選べます。次回の生成から反映されます。</p>
        {!weekdayTemplates ? (
          <p className="muted">読み込み中…</p>
        ) : (
          <ul className="weekday-list">
            {WEEKDAY_LABELS.map((label, i) => (
              <li key={label} className="weekday-item">
                <span className="weekday-item__label">{label}</span>
                <select
                  value={weekdayTemplates[i]}
                  onChange={(e) => setWeekdayTemplate(i, e.target.value as TemplateId)}
                >
                  {TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>ソース</h2>
        <p className="muted">オフにしたソースのレシピは献立生成から除外されます。</p>
        {!sources ? (
          <p className="muted">読み込み中…</p>
        ) : sources.length === 0 ? (
          <p className="muted">ソースがまだありません。</p>
        ) : (
          <ul className="source-list">
            {sources.map((s) => (
              <li key={s.id} className="source-item">
                <div className="source-item__main">
                  <span className="source-item__name">{s.name}</span>
                  <span className="source-item__meta">
                    {KIND_LABEL[s.kind] ?? s.kind}
                    {" ・ "}
                    {countBySource?.get(s.id) ?? 0} 件
                  </span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={s.is_enabled}
                    onChange={(e) => toggleSource(s.id, e.target.checked)}
                  />
                  <span>{s.is_enabled ? "有効" : "無効"}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>食材マスタ</h2>
        <p className="muted">
          材料が食材マスタに紐付いていないと、買い物リストの売場分類と常備品の除外が働きません。
          {unlinkedCount === undefined
            ? ""
            : unlinkedCount === 0
              ? " 現在、未紐付けの材料はありません。"
              : ` 未紐付けの材料が ${unlinkedCount} 件あります。`}
        </p>
        <div className="btn-row">
          <button
            onClick={handleRelink}
            disabled={busy || unlinkedCount === 0}
            className="btn btn--primary"
          >
            食材マスタに再照合
          </button>
        </div>
      </div>

      <div className="card">
        <h2>常備品</h2>
        <p className="muted">
          常備品にした食材は買い物リストから既定で除外されます（買い物リスト画面の「常備品も表示」で確認できます）。
        </p>
        {!masters ? (
          <p className="muted">読み込み中…</p>
        ) : masters.length === 0 ? (
          <p className="muted">食材がまだありません。</p>
        ) : (
          <ul className="pantry-list">
            {masters.map((m) => (
              <li key={m.id} className="pantry-item">
                <div className="pantry-item__main">
                  <span className="pantry-item__name">{m.canonical_name}</span>
                  <span className="pantry-item__meta">{CATEGORY_LABEL[m.category]}</span>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={m.is_pantry_staple}
                    onChange={(e) => togglePantry(m.id, e.target.checked)}
                  />
                  <span>{m.is_pantry_staple ? "常備品" : "毎回買う"}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>開発用データ</h2>
        <p className="muted">現在のレシピ件数: {recipeCount}</p>
        <div className="btn-row">
          <button onClick={handleSeed} disabled={busy} className="btn btn--primary">
            サンプルデータを投入
          </button>
          <button onClick={handleClear} disabled={busy} className="btn btn--danger">
            全データを消去
          </button>
        </div>
        {message && <p className="notice">{message}</p>}
      </div>

      <div className="card">
        <h2>今後実装予定</h2>
        <ul className="muted">
          <li>買い物リストへの手動追加</li>
          <li>食材マスタの統合（表記ゆれのマージ）</li>
        </ul>
      </div>
    </section>
  );
}
