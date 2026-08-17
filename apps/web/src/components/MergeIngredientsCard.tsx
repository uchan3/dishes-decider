import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type IngredientRow } from "../db/schema.ts";
import { mergeIngredients, suggestMerges, type MergeReason } from "../lib/ingredientMerge.ts";

const REASON_LABEL: Record<MergeReason, string> = {
  same_name: "同じ名前",
  contained: "名前を含む",
};

/**
 * 食材マスタの統合カード（仕様書 §5.3）。
 *
 * 取り込みも手動入力も、正規化キーが一致しなければ新しいマスタを作る。そのため
 * 「玉ねぎ」と「玉葱」のように同じ食材が分かれてしまい、分かれたままだと買い物リストで
 * 合算されない。名前が近いものを候補として出し、1 タップで寄せられるようにする。
 */
export function MergeIngredientsCard() {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [sourceId, setSourceId] = useState("");
  /** 確認待ちの組（統合は取り消せないので 2 段階にする）。 */
  const [confirming, setConfirming] = useState<{ target: string; source: string } | null>(null);

  const masters = useLiveQuery(async () => {
    const rows = await db.ingredients.toArray();
    return rows.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name, "ja"));
  }, []);

  /** 食材 ID → その食材を使っている材料行の数（残す側を決めるのに使う）。 */
  const usage = useLiveQuery(async () => {
    const lines = await db.recipeIngredients.toArray();
    const counts = new Map<string, number>();
    for (const line of lines) {
      if (line.ingredient_id === null) continue;
      counts.set(line.ingredient_id, (counts.get(line.ingredient_id) ?? 0) + 1);
    }
    return counts;
  }, []);

  const suggestions = useMemo(
    () => (masters && usage ? suggestMerges(masters, usage).slice(0, 5) : []),
    [masters, usage],
  );

  async function merge(target: IngredientRow, source: IngredientRow) {
    setBusy(true);
    setConfirming(null);
    try {
      const result = await mergeIngredients(target.id, source.id);
      setMessage(
        `「${source.canonical_name}」を「${target.canonical_name}」に統合しました` +
          `（材料 ${result.relinked} 件を付け替え）。`,
      );
      setSourceId("");
      setTargetId("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "統合に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  function mergeSelected() {
    const target = masters?.find((m) => m.id === targetId);
    const source = masters?.find((m) => m.id === sourceId);
    if (target && source) void merge(target, source);
  }

  /** 統合ボタン。1 回目で確認、2 回目で実行する。 */
  function MergeButton({ target, source }: { target: IngredientRow; source: IngredientRow }) {
    const pending = confirming?.target === target.id && confirming?.source === source.id;
    if (!pending) {
      return (
        <button
          className="btn"
          disabled={busy}
          onClick={() => setConfirming({ target: target.id, source: source.id })}
        >
          統合
        </button>
      );
    }
    return (
      <span className="btn-row">
        <button className="btn btn--danger" disabled={busy} onClick={() => void merge(target, source)}>
          統合する
        </button>
        <button className="btn" disabled={busy} onClick={() => setConfirming(null)}>
          やめる
        </button>
      </span>
    );
  }

  return (
    <div className="card">
      <h2>食材マスタの統合</h2>
      <p className="muted">
        同じ食材が別々に登録されていると買い物リストで合算されません。統合すると、消える側の名前は
        残る側の別名として引き継がれ、次回以降の取り込みでも同じものとして扱われます。
        <strong>統合は取り消せません。</strong>
      </p>

      {suggestions.length > 0 && (
        <>
          <h3 className="card__subhead">統合の候補</h3>
          <ul className="merge-list">
            {suggestions.map(({ target, source, reason }) => (
              <li key={`${target.id}:${source.id}`} className="merge-item">
                <span className="merge-item__names">
                  <strong>{source.canonical_name}</strong> → <strong>{target.canonical_name}</strong>
                  <span className="merge-item__meta"> {REASON_LABEL[reason]}</span>
                </span>
                <MergeButton target={target} source={source} />
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="card__subhead">手動で統合</h3>
      <div className="merge-picker">
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} aria-label="消える側">
          <option value="">消える側を選ぶ</option>
          {(masters ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.canonical_name}
            </option>
          ))}
        </select>
        <span className="muted">→</span>
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} aria-label="残す側">
          <option value="">残す側を選ぶ</option>
          {(masters ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.canonical_name}
            </option>
          ))}
        </select>
        <button
          className="btn btn--primary"
          disabled={busy || sourceId === "" || targetId === "" || sourceId === targetId}
          onClick={mergeSelected}
        >
          統合する
        </button>
      </div>

      {message && <p className="notice">{message}</p>}
    </div>
  );
}
