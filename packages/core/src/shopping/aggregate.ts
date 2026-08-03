/**
 * 買い物リストの集約（仕様書 F-03-1）。
 *
 * 確定献立の全スロットの材料を展開 → 人数比でスケーリング → 食材ごとにグルーピング →
 * 同系統の単位を合算（曖昧量・異系統は併記）→ 常備品を除外 → 売場カテゴリ順にソート。
 *
 * この処理はブラウザ内で完結する（LLM 不使用の純粋な集約）。
 */

import type {
  Ingredient,
  IngredientCategory,
  RecipeIngredient,
} from "../types/index.ts";
import { classifyUnit } from "./units.ts";

/** 集約対象のレシピ（材料を含む）。 */
export interface RecipeForShopping {
  id: string;
  /** レシピの基準人数。0 以下なら 1 として扱う。 */
  servings: number;
  ingredients: readonly RecipeIngredient[];
}

/** 集約の入力。 */
export interface AggregateInput {
  /** 確定献立のスロット群。recipeId が null のスロットは無視される。 */
  slots: readonly { recipeId: string | null }[];
  /** レシピ ID → レシピ。 */
  recipes: ReadonlyMap<string, RecipeForShopping>;
  /** 食材 ID → 正規化マスタ（カテゴリ・常備品判定・表示名に用いる）。 */
  ingredients: ReadonlyMap<string, Ingredient>;
  /** 世帯人数。レシピの基準人数からこの人数へスケーリングする。 */
  householdSize: number;
  /** true なら常備品も出力に含める（既定 false）。 */
  includePantryStaples?: boolean;
}

/** 買い物リストの 1 項目。 */
export interface ShoppingItem {
  ingredientId: string | null;
  displayName: string;
  /** 主たる数量（同系統で合算後）。曖昧量のみなら null。 */
  quantity: number | null;
  /** 主たる単位。曖昧量のみなら null。 */
  unit: string | null;
  /** 「適量」等の併記、および主単位に混ざらない副次量（例: "適量" / "+ 大さじ1"）。 */
  ambiguousNote: string | null;
  category: IngredientCategory;
  /** この項目に寄与したレシピ ID（内訳表示用、初出順）。 */
  sourceRecipeIds: string[];
}

/** 売場の導線順。買い物中の移動を最小化する並び。 */
const CATEGORY_ORDER: readonly IngredientCategory[] = [
  "vegetable",
  "meat",
  "seafood",
  "dairy_egg",
  "seasoning",
  "dry_goods",
  "frozen",
  "other",
];

const CATEGORY_RANK = new Map(CATEGORY_ORDER.map((c, i) => [c, i] as const));

/** 食材ごとの集約途中状態。 */
interface Bucket {
  ingredientId: string | null;
  displayName: string;
  category: IngredientCategory;
  weightG: number;
  hasWeight: boolean;
  volumeMl: number;
  hasVolume: boolean;
  /** 個数系: 単位 → 合計（初出順を保つため Map）。 */
  countByUnit: Map<string, number>;
  /** 曖昧量の語（適量・少々 など）。初出順。 */
  ambiguous: Set<string>;
  sourceRecipeIds: Set<string>;
}

/** 数量を小数第 2 位で丸める（浮動小数の誤差を除去）。 */
function roundQty(value: number): number {
  return Math.round(value * 100) / 100;
}

/** ingredientId が無い材料のグルーピングキー用に表示名を軽く正規化。 */
function normalizeName(name: string): string {
  return name.normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
}

/**
 * 献立から買い物リスト項目を生成する。
 *
 * @example
 * ```ts
 * const items = aggregateShoppingList({
 *   slots: [{ recipeId: "r1" }, { recipeId: "r2" }],
 *   recipes,      // Map<string, RecipeForShopping>
 *   ingredients,  // Map<string, Ingredient>
 *   householdSize: 2,
 * });
 * ```
 *
 * @returns 売場カテゴリ順・同カテゴリ内は表示名順にソートされた項目配列
 */
export function aggregateShoppingList(input: AggregateInput): ShoppingItem[] {
  const buckets = new Map<string, Bucket>();
  const household = input.householdSize > 0 ? input.householdSize : 1;

  for (const slot of input.slots) {
    if (slot.recipeId === null) continue;
    const recipe = input.recipes.get(slot.recipeId);
    if (!recipe) continue;
    const baseServings = recipe.servings > 0 ? recipe.servings : 1;
    const scale = household / baseServings;

    for (const ing of recipe.ingredients) {
      const master = ing.ingredientId
        ? input.ingredients.get(ing.ingredientId)
        : undefined;
      const key =
        ing.ingredientId ?? `name:${normalizeName(ing.displayName)}`;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          ingredientId: ing.ingredientId,
          displayName: master?.canonicalName ?? ing.displayName,
          category: master?.category ?? "other",
          weightG: 0,
          hasWeight: false,
          volumeMl: 0,
          hasVolume: false,
          countByUnit: new Map(),
          ambiguous: new Set(),
          sourceRecipeIds: new Set(),
        };
        buckets.set(key, bucket);
      }
      bucket.sourceRecipeIds.add(recipe.id);

      const info = classifyUnit(ing.unit);
      // 曖昧量、または数量欠落は「適量」等として併記（合算しない）。
      if (ing.isAmbiguous || ing.quantity === null || info.system === "ambiguous") {
        bucket.ambiguous.add(ing.unit && info.system === "ambiguous" ? ing.unit : "適量");
        continue;
      }

      const scaled = ing.quantity * scale;
      if (info.system === "weight") {
        bucket.weightG += scaled * info.toBase;
        bucket.hasWeight = true;
      } else if (info.system === "volume") {
        bucket.volumeMl += scaled * info.toBase;
        bucket.hasVolume = true;
      } else {
        const unit = info.baseUnit as string;
        bucket.countByUnit.set(unit, (bucket.countByUnit.get(unit) ?? 0) + scaled);
      }
    }
  }

  const items: ShoppingItem[] = [];
  for (const bucket of buckets.values()) {
    if (
      !input.includePantryStaples &&
      bucket.ingredientId &&
      input.ingredients.get(bucket.ingredientId)?.isPantryStaple
    ) {
      continue;
    }
    items.push(finalizeBucket(bucket));
  }

  items.sort((a, b) => {
    const ra = CATEGORY_RANK.get(a.category) ?? CATEGORY_ORDER.length;
    const rb = CATEGORY_RANK.get(b.category) ?? CATEGORY_ORDER.length;
    if (ra !== rb) return ra - rb;
    return a.displayName.localeCompare(b.displayName, "ja");
  });

  return items;
}

/**
 * 集約バケットを ShoppingItem に確定する。
 *
 * 主たる数量は 重量 > 容量 > 個数 の優先で 1 つ選び、それ以外の量（他系統・複数の個数単位・
 * 曖昧量）は `ambiguousNote` に併記する。ShoppingItem が単一の quantity/unit しか持たないため。
 */
function finalizeBucket(bucket: Bucket): ShoppingItem {
  const notes: string[] = [];
  let quantity: number | null = null;
  let unit: string | null = null;

  // 個数系はまず単位ごとに確定しておく（主単位に採らない分は併記へ）。
  const counts = [...bucket.countByUnit.entries()].map(
    ([u, q]) => [u, roundQty(q)] as const,
  );

  if (bucket.hasWeight) {
    quantity = roundQty(bucket.weightG);
    unit = "g";
    if (bucket.hasVolume) notes.push(`${roundQty(bucket.volumeMl)}ml`);
    for (const [u, q] of counts) notes.push(`${q}${u}`);
  } else if (bucket.hasVolume) {
    quantity = roundQty(bucket.volumeMl);
    unit = "ml";
    for (const [u, q] of counts) notes.push(`${q}${u}`);
  } else if (counts.length > 0) {
    // 個数系のみ。最初の単位を主とし、残りは併記。
    const [primary, ...rest] = counts;
    quantity = (primary as readonly [string, number])[1];
    unit = (primary as readonly [string, number])[0];
    for (const [u, q] of rest) notes.push(`${q}${u}`);
  }

  for (const a of bucket.ambiguous) notes.push(a);

  return {
    ingredientId: bucket.ingredientId,
    displayName: bucket.displayName,
    quantity,
    unit,
    ambiguousNote: notes.length > 0 ? notes.join(" + ") : null,
    category: bucket.category,
    sourceRecipeIds: [...bucket.sourceRecipeIds],
  };
}
