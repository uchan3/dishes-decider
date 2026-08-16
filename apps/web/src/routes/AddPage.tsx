import { useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { classifyIngredient } from "@recipe-planner/core";
import type {
  CookingMethod,
  DishRole,
  IngredientCategory,
} from "@recipe-planner/core";
import { db } from "../db/schema.ts";
import { useAuth } from "../lib/auth.tsx";
import { matchMaster } from "../lib/ingredients.ts";
import {
  saveManualRecipe,
  validateRecipeForm,
  type RecipeFormData,
} from "../lib/recipeForm.ts";

const DISH_ROLES: { value: DishRole; label: string }[] = [
  { value: "main", label: "主菜" },
  { value: "side", label: "副菜" },
  { value: "one_dish", label: "一皿完結" },
  { value: "soup", label: "汁物" },
  { value: "staple", label: "主食" },
];

const COOKING_METHODS: { value: CookingMethod; label: string }[] = [
  { value: "fry", label: "炒める・揚げる" },
  { value: "simmer", label: "煮る" },
  { value: "grill", label: "焼く" },
  { value: "steam", label: "蒸す" },
  { value: "raw", label: "生・和える" },
];

const CATEGORIES: { value: IngredientCategory; label: string }[] = [
  { value: "vegetable", label: "野菜" },
  { value: "meat", label: "肉" },
  { value: "seafood", label: "魚" },
  { value: "dairy_egg", label: "乳製品・卵" },
  { value: "seasoning", label: "調味料" },
  { value: "dry_goods", label: "乾物" },
  { value: "frozen", label: "冷凍" },
  { value: "other", label: "その他" },
];

const CATEGORY_LABEL = new Map(CATEGORIES.map((c) => [c.value, c.label] as const));
const COMMON_UNITS = ["個", "本", "枚", "束", "パック", "丁", "片", "g", "kg", "ml", "大さじ", "小さじ", "カップ"];

/** フォームローカルの材料行（数量は入力しやすいよう文字列で保持）。 */
interface FormIngredient {
  displayName: string;
  quantity: string;
  unit: string;
  isAmbiguous: boolean;
  newCategory: IngredientCategory;
  /** ユーザーが売場を手で選んだか。true なら名前を変えても自動推定で上書きしない。 */
  categoryTouched: boolean;
}

const emptyIngredient = (): FormIngredient => ({
  displayName: "",
  quantity: "",
  unit: "",
  isAmbiguous: false,
  newCategory: "other",
  categoryTouched: false,
});

/** レシピ手動登録画面（US-02）。 */
export function AddPage() {
  const navigate = useNavigate();
  const { userId } = useAuth();
  const masters = useLiveQuery(() => db.ingredients.toArray(), [], []);

  const [title, setTitle] = useState("");
  const [dishRoles, setDishRoles] = useState<DishRole[]>(["main"]);
  const [cookTime, setCookTime] = useState("");
  const [servings, setServings] = useState("2");
  const [mainCategory, setMainCategory] = useState("");
  const [method, setMethod] = useState<CookingMethod | "">("");
  const [tagsText, setTagsText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [ingredients, setIngredients] = useState<FormIngredient[]>([emptyIngredient()]);

  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function toggleRole(role: DishRole) {
    setDishRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  function updateIngredient(index: number, patch: Partial<FormIngredient>) {
    setIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)));
  }

  /**
   * 材料名の変更を反映する。新規食材の売場は取り込みパイプラインと同じ推定
   * （{@link classifyIngredient}）を初期値にする。手で選び直した行は上書きしない。
   */
  function updateIngredientName(index: number, displayName: string) {
    setIngredients((prev) =>
      prev.map((ing, i) => {
        if (i !== index) return ing;
        const next = { ...ing, displayName };
        if (!ing.categoryTouched) next.newCategory = classifyIngredient(displayName).category;
        return next;
      }),
    );
  }

  function addIngredient() {
    setIngredients((prev) => [...prev, emptyIngredient()]);
  }

  function removeIngredient(index: number) {
    setIngredients((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  const formData = useMemo<RecipeFormData>(
    () => ({
      title,
      dishRoles,
      cookTimeMin: cookTime.trim() === "" ? null : Number(cookTime),
      servings: Number(servings) || 0,
      mainIngredientCategory: mainCategory.trim() === "" ? null : mainCategory.trim(),
      cookingMethod: method === "" ? null : method,
      tags: tagsText
        .split(/[,、\s]+/)
        .map((t) => t.trim())
        .filter(Boolean),
      sourceUrl: sourceUrl.trim() === "" ? null : sourceUrl.trim(),
      isFavorite,
      ingredients: ingredients.map((i) => ({
        displayName: i.displayName,
        quantity: i.quantity.trim() === "" ? null : Number(i.quantity),
        unit: i.unit.trim() === "" ? null : i.unit.trim(),
        isAmbiguous: i.isAmbiguous,
        newCategory: i.newCategory,
      })),
    }),
    [title, dishRoles, cookTime, servings, mainCategory, method, tagsText, sourceUrl, isFavorite, ingredients],
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const validationErrors = validateRecipeForm(formData);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);
    setSaving(true);
    try {
      await saveManualRecipe(formData, userId);
      navigate("/library");
    } catch (err) {
      // Supabase への保存に失敗した場合はここに来る（Dexie にも書いていない）。
      setErrors([err instanceof Error ? err.message : "保存に失敗しました"]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h1>レシピを追加</h1>

      {errors.length > 0 && (
        <div className="notice notice--warn">
          <ul className="error-list">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} className="form">
        <label className="field">
          <span className="field__label">料理名 *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="豚の生姜焼き" />
        </label>

        <div className="field">
          <span className="field__label">役割 *（複数可）</span>
          <div className="chips">
            {DISH_ROLES.map((r) => (
              <button
                type="button"
                key={r.value}
                className={dishRoles.includes(r.value) ? "chip chip--on" : "chip"}
                onClick={() => toggleRole(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field__label">人数 *</span>
            <input type="number" min="1" value={servings} onChange={(e) => setServings(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">調理時間（分）</span>
            <input type="number" min="0" value={cookTime} onChange={(e) => setCookTime(e.target.value)} placeholder="20" />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field__label">調理法</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as CookingMethod | "")}>
              <option value="">指定なし</option>
              {COOKING_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">主要食材（多様性用）</span>
            <input
              value={mainCategory}
              onChange={(e) => setMainCategory(e.target.value)}
              placeholder="pork / chicken など"
            />
          </label>
        </div>

        <label className="field">
          <span className="field__label">タグ（カンマ区切り）</span>
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="時短, ヘルシー" />
        </label>

        <label className="field">
          <span className="field__label">原典 URL</span>
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
        </label>

        <label className="checkbox-field">
          <input type="checkbox" checked={isFavorite} onChange={(e) => setIsFavorite(e.target.checked)} />
          お気に入り
        </label>

        <h2 className="form__section">材料 *</h2>
        <datalist id="master-names">
          {masters.map((m) => (
            <option key={m.id} value={m.canonical_name} />
          ))}
        </datalist>
        <datalist id="common-units">
          {COMMON_UNITS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>

        <div className="ing-list">
          {ingredients.map((ing, index) => {
            const matched =
              ing.displayName.trim() !== "" ? matchMaster(ing.displayName, masters) : undefined;
            const isNew = ing.displayName.trim() !== "" && !matched;
            return (
              <div key={index} className="ing-row">
                <div className="ing-row__inputs">
                  <input
                    className="ing-name"
                    list="master-names"
                    value={ing.displayName}
                    onChange={(e) => updateIngredientName(index, e.target.value)}
                    placeholder="玉ねぎ"
                  />
                  <input
                    className="ing-qty"
                    type="number"
                    step="any"
                    value={ing.quantity}
                    disabled={ing.isAmbiguous}
                    onChange={(e) => updateIngredient(index, { quantity: e.target.value })}
                    placeholder="1"
                  />
                  <input
                    className="ing-unit"
                    list="common-units"
                    value={ing.unit}
                    disabled={ing.isAmbiguous}
                    onChange={(e) => updateIngredient(index, { unit: e.target.value })}
                    placeholder="個"
                  />
                  <button
                    type="button"
                    className="ing-remove"
                    onClick={() => removeIngredient(index)}
                    aria-label="材料を削除"
                  >
                    ×
                  </button>
                </div>
                <div className="ing-row__meta">
                  <label className="ing-ambiguous">
                    <input
                      type="checkbox"
                      checked={ing.isAmbiguous}
                      onChange={(e) => updateIngredient(index, { isAmbiguous: e.target.checked })}
                    />
                    適量
                  </label>
                  {matched && (
                    <span className="ing-hint ing-hint--match">
                      → 既存: {matched.canonical_name}（{CATEGORY_LABEL.get(matched.category)}）
                    </span>
                  )}
                  {isNew && (
                    <span className="ing-hint ing-hint--new">
                      新規食材 · 売場
                      <select
                        value={ing.newCategory}
                        onChange={(e) =>
                          updateIngredient(index, {
                            newCategory: e.target.value as IngredientCategory,
                            categoryTouched: true,
                          })
                        }
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" className="btn" onClick={addIngredient}>
          + 材料を追加
        </button>

        <button type="submit" className="btn btn--primary btn--block" disabled={saving}>
          {saving ? "保存中…" : "レシピを保存"}
        </button>
      </form>
    </section>
  );
}
