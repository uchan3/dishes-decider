/**
 * 食材の正規化（仕様書 §5.3）の公開エントリ。
 *
 * 照合キー生成 (`name.ts`)・マスタ照合 (`match.ts`)・カテゴリ推定 (`category.ts`) を
 * まとめて公開する。手動入力（apps/web）と抽出パイプライン（supabase/functions）が
 * 同じロジックを共有するために core に置いている。
 */

export { normalizeIngredientName } from "./name.ts";
export {
  createIngredientIndex,
  matchIngredientMaster,
  type IngredientIndex,
  type IngredientMasterKeys,
} from "./match.ts";
export {
  classifyIngredient,
  type IngredientClassification,
} from "./category.ts";
