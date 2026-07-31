/**
 * 週間献立プランナーの共有ドメイン型。
 *
 * DB (PostgreSQL / Dexie) は snake_case だが、ドメイン層では camelCase を用いる。
 * snake_case <-> camelCase の変換は永続化層 (apps/web の db / supabase) の責務であり、
 * `packages/core` はこの純粋な型のみを扱う。
 *
 * このファイルはブラウザと Deno の両方から読まれる。npm 依存・Node 組み込みは持たない。
 */

/**
 * 料理が献立のどの枠に嵌るか。1 レシピに複数付与可（例: 肉じゃがは `main` かつ `side`）。
 */
export type DishRole = "main" | "side" | "one_dish" | "soup" | "staple";

/** 主要な調理法。多様性チェック（同じ調理法の偏り回避）に用いる。 */
export type CookingMethod = "fry" | "simmer" | "grill" | "steam" | "raw";

/**
 * 売場カテゴリ。買い物リストはこの順（野菜 → 肉 → 魚 → 乳製品・卵 → 調味料 → 乾物 → 冷凍）で
 * ソートする。スーパーの導線に沿わせることで買い物中の移動を最小化する。
 */
export type IngredientCategory =
  | "vegetable"
  | "meat"
  | "seafood"
  | "dairy_egg"
  | "seasoning"
  | "dry_goods"
  | "frozen"
  | "other";

/** 1 食の種別。MVP は dinner のみ運用するが、データモデルは拡張可能にしておく。 */
export type MealType = "breakfast" | "lunch" | "dinner";

/**
 * 正規化された食材マスタ。表記ゆれ（玉ねぎ/たまねぎ/玉葱）を 1 つの `id` に集約する。
 * 買い物リストの合算はこの `id` を軸に行うため、正規化の品質がプロダクトの生命線になる。
 */
export interface Ingredient {
  id: string;
  canonicalName: string;
  category: IngredientCategory;
  /** 常備品（塩・醤油等）。買い物リストからデフォルト除外される。 */
  isPantryStaple: boolean;
  /** 同一カテゴリ内での表示順。 */
  sortOrder: number;
}

/**
 * レシピ 1 件分の材料。原文 `rawText` は取り込み時の確認用で、集約は正規化済みの
 * `ingredientId` / `quantity` / `unit` を使う。
 */
export interface RecipeIngredient {
  id: string;
  recipeId: string;
  /** 正規化食材マスタへの参照。未マッピングなら null。 */
  ingredientId: string | null;
  displayName: string;
  /** 抽出元の原文（例: 「玉ねぎ 1/2個」）。 */
  rawText: string;
  /** 正規化後の数量。`適量`/`少々` などの曖昧量は null。 */
  quantity: number | null;
  /** 正規化後の単位（例: `g` / `ml` / `個`）。 */
  unit: string | null;
  /** `適量`/`少々`/`お好みで` などの曖昧量フラグ。true なら合算しない。 */
  isAmbiguous: boolean;
}

/**
 * レシピ本体。手順の原文は保持せず、献立生成・買い物リストに必要な構造化データのみを持つ
 * （著作権制約: 「事実は保存する。表現は借りて表示する。」）。
 */
export interface Recipe {
  id: string;
  sourceId: string | null;
  title: string;
  dishRoles: DishRole[];
  /** 調理時間（分）。不明なら null。 */
  cookTimeMin: number | null;
  /** レシピの基準人数。買い物リストのスケーリングに用いる。 */
  servings: number;
  /** 主要食材カテゴリ（例: `pork` / `chicken` / `fish`）。週内の多様性チェックに用いる。 */
  mainIngredientCategory: string | null;
  cookingMethod: CookingMethod | null;
  tags: string[];
  isFavorite: boolean;
  /** 「もう出さないで」による恒久除外。 */
  isExcluded: boolean;
  /** 調理回数。少ないほど novelty スコアが高い（未調理レシピを優遇）。 */
  cookCount: number;
  /** 最終調理日 (YYYY-MM-DD)。クールダウン判定・recency スコアに用いる。未調理なら null。 */
  lastCookedAt: string | null;
  /** 再抽選で弾かれた回数。多いほど reject ペナルティが増す。 */
  rejectCount: number;
}

/** 1 食を構成するスロットの並び（ユーザー定義可）。例: 標準 = `['main','side']`。 */
export interface MealTemplate {
  id: string;
  name: string;
  slots: DishRole[];
}

/** 献立の 1 スロット。レシピ 1 品が割り当たる最小単位。 */
export interface PlanSlot {
  id: string;
  dishRole: DishRole;
  /** 割り当てられたレシピ。未割当なら null。 */
  recipeId: string | null;
  /** 🔒 ロック。以降の再抽選対象から除外される。 */
  isLocked: boolean;
  position: number;
}

/** 1 日 1 食分。複数スロット（主菜 + 副菜など）を束ねる。 */
export interface Meal {
  id: string;
  /** 対象日 (YYYY-MM-DD)。 */
  date: string;
  mealType: MealType;
  templateId: string | null;
  /** 外食・作らない。true なら献立生成・買い物リストの対象外。 */
  isSkipped: boolean;
  slots: PlanSlot[];
}

/** 1 週間分の献立。 */
export interface MealPlan {
  id: string;
  /** 週の開始日 (YYYY-MM-DD)。 */
  startDate: string;
  status: "draft" | "confirmed" | "archived";
  meals: Meal[];
}
