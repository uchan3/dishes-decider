import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema.ts";
import { seedSampleData } from "../db/seed.ts";

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

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    void db.sources.update(id, { is_enabled: next });
  }

  return (
    <section>
      <h1>設定</h1>

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
          <li>常備品（パントリー）管理</li>
          <li>世帯人数・クールダウン等の生成設定</li>
          <li>食材マスタの統合</li>
        </ul>
      </div>
    </section>
  );
}
