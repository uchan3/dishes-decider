import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/schema.ts";
import { deleteRecipe, parseTags, updateRecipe } from "../lib/recipeEdit.ts";
import { youtubeVideoId } from "../lib/youtube.ts";

const ROLE_LABEL: Record<string, string> = {
  main: "主菜",
  side: "副菜",
  one_dish: "一皿完結",
  soup: "汁物",
  staple: "主食",
};

const METHOD_LABEL: Record<string, string> = {
  fry: "炒める・揚げる",
  simmer: "煮る",
  grill: "焼く",
  steam: "蒸す",
  raw: "生・和える",
};

/** レシピ詳細画面。材料・原典リンク・お気に入り/タグ編集・除外を扱う。 */
export function RecipeDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const recipe = useLiveQuery(() => db.recipes.get(id), [id]);
  const ingredients = useLiveQuery(
    () => db.recipeIngredients.where("recipe_id").equals(id).sortBy("position"),
    [id],
  );
  const source = useLiveQuery(
    async () => (recipe?.source_id ? db.sources.get(recipe.source_id) : undefined),
    [recipe?.source_id],
  );

  // タグ編集はレシピが切り替わったときだけ初期化する（入力中の値を保持）。
  const [tagsText, setTagsText] = useState("");
  const [tagsDirty, setTagsDirty] = useState(false);
  useEffect(() => {
    if (recipe) {
      setTagsText(recipe.tags.join(", "));
      setTagsDirty(false);
    }
  }, [recipe?.id]);

  // 削除は誤操作防止のため2段階（確認）にする。
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteRecipe(id);
      navigate("/library");
    } catch (e) {
      setDeleting(false);
      setConfirmDelete(false);
      alert(e instanceof Error ? e.message : "削除に失敗しました");
    }
  }

  if (recipe === undefined) return <p className="muted">読み込み中…</p>;
  if (recipe === null) {
    return (
      <section>
        <Link to="/library" className="back-link">← レシピ一覧</Link>
        <div className="empty">
          <p>レシピが見つかりませんでした。</p>
        </div>
      </section>
    );
  }

  const videoId = youtubeVideoId(recipe.source_url);

  async function saveTags() {
    await updateRecipe(id, { tags: parseTags(tagsText) });
    setTagsDirty(false);
  }

  return (
    <section className="detail">
      <Link to="/library" className="back-link">← レシピ一覧</Link>

      <header className="detail__head">
        <h1>{recipe.title}</h1>
        <div className="detail__meta">
          {recipe.dish_roles.map((r) => (
            <span key={r} className="tag">{ROLE_LABEL[r] ?? r}</span>
          ))}
          {recipe.cook_time_min !== null && <span className="muted">{recipe.cook_time_min}分</span>}
          <span className="muted">{recipe.servings}人前</span>
          {recipe.cooking_method && (
            <span className="muted">{METHOD_LABEL[recipe.cooking_method] ?? recipe.cooking_method}</span>
          )}
        </div>
        {source && <p className="muted">出典: {source.name}</p>}
      </header>

      <div className="btn-row">
        <button
          className={recipe.is_favorite ? "btn btn--primary" : "btn"}
          onClick={() => updateRecipe(id, { is_favorite: !recipe.is_favorite })}
        >
          {recipe.is_favorite ? "★ お気に入り" : "☆ お気に入り"}
        </button>
        <button
          className={recipe.is_excluded ? "btn btn--danger" : "btn"}
          onClick={() => updateRecipe(id, { is_excluded: !recipe.is_excluded })}
        >
          {recipe.is_excluded ? "除外中（もう出さない）" : "もう出さないで"}
        </button>
      </div>
      {recipe.is_excluded && (
        <p className="notice notice--warn">このレシピは献立生成の対象外です。</p>
      )}

      <div className="card">
        <h2>材料（{recipe.servings}人前）</h2>
        {!ingredients ? (
          <p className="muted">読み込み中…</p>
        ) : ingredients.length === 0 ? (
          <p className="muted">材料が登録されていません。</p>
        ) : (
          <ul className="detail-ing-list">
            {ingredients.map((ing) => (
              <li key={ing.id} className="detail-ing">
                <span>{ing.display_name}</span>
                <span className="muted">
                  {ing.is_ambiguous || ing.quantity === null
                    ? "適量"
                    : `${ing.quantity}${ing.unit ?? ""}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>手順</h2>
        {videoId ? (
          <div className="embed">
            <iframe
              src={`https://www.youtube.com/embed/${videoId}`}
              title={recipe.title}
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <p className="muted">
            手順の要約は未取得です。原典で手順をご確認ください。
          </p>
        )}
        {recipe.source_url && (
          <a href={recipe.source_url} target="_blank" rel="noreferrer" className="btn btn--block">
            元の投稿を見る ↗
          </a>
        )}
      </div>

      <div className="card">
        <h2>タグ</h2>
        <label className="field">
          <span className="field__label">カンマ区切りで編集</span>
          <input
            value={tagsText}
            onChange={(e) => {
              setTagsText(e.target.value);
              setTagsDirty(true);
            }}
            placeholder="時短, ヘルシー"
          />
        </label>
        <button className="btn" onClick={saveTags} disabled={!tagsDirty}>
          タグを保存
        </button>
      </div>

      <div className="card">
        <h2>このレシピを削除</h2>
        <p className="muted">重複や取り込み失敗したレシピを削除します。元に戻せません。</p>
        {confirmDelete ? (
          <div className="btn-row">
            <button className="btn btn--danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? "削除中…" : "本当に削除する"}
            </button>
            <button className="btn" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              キャンセル
            </button>
          </div>
        ) : (
          <button className="btn btn--danger" onClick={() => setConfirmDelete(true)}>
            削除
          </button>
        )}
      </div>
    </section>
  );
}
