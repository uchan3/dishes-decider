import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema.ts";
import { seedSampleData } from "../db/seed.ts";

/** 設定画面。現状はサンプルデータの投入・全消去のみ（開発用）。 */
export function SettingsPage() {
  const recipeCount = useLiveQuery(() => db.recipes.count(), [], 0);
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

  return (
    <section>
      <h1>設定</h1>

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
          <li>ソース管理（献立生成の対象トグル）</li>
          <li>常備品（パントリー）管理</li>
          <li>世帯人数・クールダウン等の生成設定</li>
          <li>食材マスタの統合</li>
        </ul>
      </div>
    </section>
  );
}
