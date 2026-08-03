/** レシピ追加画面（プレースホルダ）。URL 抽出・手動入力は後続スライスで実装する。 */
export function AddPage() {
  return (
    <section>
      <h1>レシピを追加</h1>
      <div className="empty">
        <p className="muted">この画面は未実装です。</p>
        <p className="muted">
          今後のスライスで、URL からの AI 抽出（iOS ショートカット → Edge Function）と
          手動入力フォームを追加します。
        </p>
      </div>
    </section>
  );
}
