/**
 * 週間献立の生成アルゴリズム（仕様書 F-02-2）。
 *
 * 制約充足 + 重み付きランダム選択。厳密最適化はせず、貪欲法 + リトライで十分。
 * この処理はすべてブラウザ内で完結する（サーバー・LLM 不使用、非機能要件「1 秒以内」）。
 *
 * 手順:
 *   1. 候補プール構築（dish_role が合致）
 *   2. ハードフィルタ（クールダウン / 除外 / 同一週重複 / 同一食事内重複 / 調理時間上限）
 *   3. スコアリング（{@link scoreRecipe}）
 *   4. softmax で確率的サンプリング
 *   5. 多様性チェック（週内の主要食材の偏りを是正、最大リトライ）
 *   6. 候補不足時は制約を段階的に緩和（調理時間 → クールダウン → 同一週重複）し通知
 */

import type { DishRole, Recipe } from "../types/index.ts";
import { mulberry32, sampleIndex, softmax, type Rng } from "./rng.ts";
import { DEFAULT_WEIGHTS, daysBetween, scoreRecipe, type ScoreWeights } from "./scoring.ts";

/** 生成対象の 1 スロット。 */
export interface SlotRequest {
  slotId: string;
  dishRole: DishRole;
  /** 休日か。調理時間上限（平日/休日）の選択に用いる。 */
  isWeekend: boolean;
  /** ロック済みなら固定するレシピ ID。指定時はそのまま採用され再抽選されない。 */
  lockedRecipeId?: string | null;
  /**
   * 同じ食事（同じ日の献立）に属するスロットをまとめる ID。
   *
   * **同一食事内での重複は制約緩和の対象にしない**。候補が足りないときに同じ週へ
   * 同じ料理が複数回出るのは許容できるが、同じ日の主菜と副菜が同じ料理になるのは
   * 献立として成立しないため。未指定なら食事単位の重複判定は行わない。
   */
  mealId?: string;
}

/** 生成設定。 */
export interface GenerationSettings {
  /** この日数以内に調理したレシピは除外。 */
  cooldownDays: number;
  /** 平日の調理時間上限（分）。null = 制限なし。 */
  weekdayMaxCookMin: number | null;
  /** 休日の調理時間上限（分）。null = 制限なし。 */
  weekendMaxCookMin: number | null;
  weights: ScoreWeights;
  /** 週内で同一主要食材カテゴリがこの数を超えたら再抽選する。 */
  varietyThreshold: number;
  /** 多様性チェックの最大リトライ回数。 */
  maxVarietyRetries: number;
  /** softmax 温度。高いほど多様、低いほど高スコアに集中。 */
  temperature: number;
}

/** 既定の生成設定。 */
export const DEFAULT_SETTINGS: GenerationSettings = {
  cooldownDays: 14,
  weekdayMaxCookMin: null,
  weekendMaxCookMin: null,
  weights: DEFAULT_WEIGHTS,
  varietyThreshold: 3,
  maxVarietyRetries: 3,
  temperature: 1,
};

/** 緩和された制約の種類。 */
export type RelaxedConstraint = "cook_time" | "cooldown" | "same_week_duplicate";

/** 緩和の適用順（緩めても影響が小さいものから）。 */
const RELAXATION_ORDER: readonly RelaxedConstraint[] = [
  "cook_time",
  "cooldown",
  "same_week_duplicate",
];

/** 1 スロットの割り当て結果。 */
export interface SlotAssignment {
  slotId: string;
  /** 割り当てられたレシピ。埋められなければ null。 */
  recipeId: string | null;
  /** ロック由来か。 */
  locked: boolean;
  /** このスロットを埋めるために緩和した制約。 */
  relaxed: RelaxedConstraint[];
}

/** 生成入力。 */
export interface GenerateInput {
  slots: SlotRequest[];
  recipes: Recipe[];
  /** 基準日 (YYYY-MM-DD)。クールダウン・recency の起点。 */
  referenceDate: string;
  settings?: Partial<GenerationSettings>;
  /**
   * レシピ ID → 在庫適合度 `[0, 1]`。冷蔵庫にある材料で作れるレシピを少しだけ
   * 選ばれやすくする（docs/pantry.md §5）。**ハードフィルタにはしない**ので、
   * 在庫が空でも生成の挙動は変わらない。
   */
  pantryScores?: ReadonlyMap<string, number>;
  /** 候補から常に除外したいレシピ ID（他献立で採用済み等）。 */
  excludeRecipeIds?: readonly string[];
  /** 乱数源。省略時は referenceDate 由来のシードで決定論的に動く。 */
  rng?: Rng;
}

/** 生成結果。 */
export interface GenerateResult {
  assignments: SlotAssignment[];
  /** 埋められなかったスロット ID。 */
  unfilledSlotIds: string[];
  /** 全体で緩和が発生した制約の集合（UI 通知用、適用順）。 */
  relaxations: RelaxedConstraint[];
}

/** referenceDate から安定したシードを作る（rng 未指定時の決定論性のため）。 */
function seedFromDate(date: string): number {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 段階緩和で無効化する制約を表す内部フラグ。 */
interface Relaxation {
  cookTime: boolean;
  cooldown: boolean;
  sameWeekDuplicate: boolean;
}

const NO_RELAXATION: Relaxation = {
  cookTime: false,
  cooldown: false,
  sameWeekDuplicate: false,
};

/** 指定の緩和レベルで、スロットに嵌る候補レシピを絞り込む。 */
function filterCandidates(
  slot: SlotRequest,
  recipes: readonly Recipe[],
  used: ReadonlySet<string>,
  usedInMeal: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
  referenceDate: string,
  settings: GenerationSettings,
  relax: Relaxation,
): Recipe[] {
  const maxCook = slot.isWeekend ? settings.weekendMaxCookMin : settings.weekdayMaxCookMin;
  return recipes.filter((r) => {
    if (!r.dishRoles.includes(slot.dishRole)) return false;
    if (r.isExcluded) return false; // 「もう出さないで」は緩和しない
    if (usedInMeal.has(r.id)) return false; // 同じ食事の中での重複も緩和しない
    if (excluded.has(r.id)) return false;
    if (!relax.sameWeekDuplicate && used.has(r.id)) return false;
    if (
      !relax.cooldown &&
      r.lastCookedAt !== null &&
      daysBetween(r.lastCookedAt, referenceDate) < settings.cooldownDays
    ) {
      return false;
    }
    if (
      !relax.cookTime &&
      maxCook !== null &&
      r.cookTimeMin !== null &&
      r.cookTimeMin > maxCook
    ) {
      return false;
    }
    return true;
  });
}

/**
 * スロット 1 つの候補を、必要に応じて制約を段階緩和しながら構築する。
 * 緩和は {@link RELAXATION_ORDER} の順（調理時間 → クールダウン → 同一週重複）に累積適用する。
 */
function buildCandidates(
  slot: SlotRequest,
  recipes: readonly Recipe[],
  used: ReadonlySet<string>,
  usedInMeal: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
  referenceDate: string,
  settings: GenerationSettings,
): { candidates: Recipe[]; relaxed: RelaxedConstraint[] } {
  const relax: Relaxation = { ...NO_RELAXATION };
  const relaxed: RelaxedConstraint[] = [];

  let candidates = filterCandidates(
    slot,
    recipes,
    used,
    usedInMeal,
    excluded,
    referenceDate,
    settings,
    relax,
  );

  for (const step of RELAXATION_ORDER) {
    if (candidates.length > 0) break;
    if (step === "cook_time") relax.cookTime = true;
    else if (step === "cooldown") relax.cooldown = true;
    else relax.sameWeekDuplicate = true;
    relaxed.push(step);
    candidates = filterCandidates(
      slot,
      recipes,
      used,
      usedInMeal,
      excluded,
      referenceDate,
      settings,
      relax,
    );
  }

  return { candidates, relaxed };
}

/** 候補群からスコア → softmax → サンプリングでレシピを 1 つ選ぶ。 */
function pickRecipe(
  candidates: readonly Recipe[],
  selected: readonly Recipe[],
  referenceDate: string,
  settings: GenerationSettings,
  rng: Rng,
  pantryScores?: ReadonlyMap<string, number>,
): Recipe | null {
  if (candidates.length === 0) return null;
  const scores = candidates.map((r) =>
    scoreRecipe(r, {
      referenceDate,
      horizonDays: settings.cooldownDays,
      selected,
      weights: settings.weights,
      ...(pantryScores === undefined ? {} : { pantryScores }),
    }),
  );
  const probs = softmax(scores, settings.temperature);
  const idx = sampleIndex(probs, rng);
  return candidates[idx] ?? null;
}

/** 週内で過剰な主要食材カテゴリ（threshold 超え）があれば、その 1 つを返す。 */
function findOverusedCategory(
  selected: readonly Recipe[],
  threshold: number,
): string | null {
  const counts = new Map<string, number>();
  for (const r of selected) {
    if (r.mainIngredientCategory === null) continue;
    const next = (counts.get(r.mainIngredientCategory) ?? 0) + 1;
    counts.set(r.mainIngredientCategory, next);
    if (next > threshold) return r.mainIngredientCategory;
  }
  return null;
}

/**
 * 週間献立を生成する。
 *
 * ロック済みスロットは固定され、残りのスロットを貪欲 + 確率的サンプリングで埋める。
 * 候補が枠を満たせない場合は制約を段階緩和し、緩和内容を {@link GenerateResult.relaxations}
 * で返す。週内の主要食材が偏った場合は該当スロットを再抽選する。
 *
 * @example
 * ```ts
 * const result = generateMealPlan({
 *   slots: [{ slotId: "s1", dishRole: "main", isWeekend: false }],
 *   recipes,
 *   referenceDate: "2026-07-30",
 * });
 * result.assignments[0].recipeId; // 選ばれたレシピ、または null
 * ```
 */
export function generateMealPlan(input: GenerateInput): GenerateResult {
  const settings: GenerationSettings = { ...DEFAULT_SETTINGS, ...input.settings };
  const rng = input.rng ?? mulberry32(seedFromDate(input.referenceDate));
  const byId = new Map(input.recipes.map((r) => [r.id, r] as const));
  const excluded = new Set(input.excludeRecipeIds ?? []);

  const used = new Set<string>();
  /** 食事 ID → その食事で既に使ったレシピ。同一食事内の重複を防ぐ。 */
  const usedByMeal = new Map<string, Set<string>>();
  const selected: Recipe[] = [];
  const assignments: SlotAssignment[] = [];
  const relaxations = new Set<RelaxedConstraint>();

  /** スロットが属する食事の使用済み集合（`mealId` 未指定なら空集合）。 */
  const mealSet = (slot: SlotRequest): Set<string> => {
    if (slot.mealId === undefined) return new Set();
    let set = usedByMeal.get(slot.mealId);
    if (!set) {
      set = new Set();
      usedByMeal.set(slot.mealId, set);
    }
    return set;
  };

  // 1) ロック済みスロットを先に確定（同一週重複判定・多様性算出に含める）。
  for (const slot of input.slots) {
    if (slot.lockedRecipeId == null) continue;
    const recipe = byId.get(slot.lockedRecipeId) ?? null;
    assignments.push({
      slotId: slot.slotId,
      recipeId: slot.lockedRecipeId,
      locked: true,
      relaxed: [],
    });
    if (recipe) {
      used.add(recipe.id);
      mealSet(slot).add(recipe.id);
      selected.push(recipe);
    }
  }

  // 2) 未ロックスロットを順に埋める。
  for (const slot of input.slots) {
    if (slot.lockedRecipeId != null) continue;
    const { candidates, relaxed } = buildCandidates(
      slot,
      input.recipes,
      used,
      mealSet(slot),
      excluded,
      input.referenceDate,
      settings,
    );
    const pick = pickRecipe(
      candidates,
      selected,
      input.referenceDate,
      settings,
      rng,
      input.pantryScores,
    );
    for (const r of relaxed) relaxations.add(r);

    assignments.push({
      slotId: slot.slotId,
      recipeId: pick?.id ?? null,
      locked: false,
      relaxed,
    });
    if (pick) {
      used.add(pick.id);
      mealSet(slot).add(pick.id);
      selected.push(pick);
    }
  }

  // 5) 多様性チェック: 過剰カテゴリのスロットを再抽選（最大リトライ）。
  applyVarietyRetries(
    input,
    settings,
    rng,
    byId,
    excluded,
    used,
    usedByMeal,
    selected,
    assignments,
  );

  const unfilledSlotIds = assignments
    .filter((a) => a.recipeId === null)
    .map((a) => a.slotId);

  return {
    assignments,
    unfilledSlotIds,
    relaxations: RELAXATION_ORDER.filter((c) => relaxations.has(c)),
  };
}

/**
 * 週内の主要食材カテゴリが偏っている場合、未ロックの該当スロットを再抽選する。
 * `assignments` / `used` / `selected` を破壊的に更新する。
 */
function applyVarietyRetries(
  input: GenerateInput,
  settings: GenerationSettings,
  rng: Rng,
  byId: ReadonlyMap<string, Recipe>,
  excluded: ReadonlySet<string>,
  used: Set<string>,
  usedByMeal: Map<string, Set<string>>,
  selected: Recipe[],
  assignments: SlotAssignment[],
): void {
  const slotById = new Map(input.slots.map((s) => [s.slotId, s] as const));

  for (let attempt = 0; attempt < settings.maxVarietyRetries; attempt++) {
    const overused = findOverusedCategory(selected, settings.varietyThreshold);
    if (overused === null) return;

    // 過剰カテゴリを持つ「未ロック」スロットを 1 つ選ぶ。
    const target = assignments.find((a) => {
      if (a.locked || a.recipeId === null) return false;
      return byId.get(a.recipeId)?.mainIngredientCategory === overused;
    });
    if (!target || target.recipeId === null) return;

    const slot = slotById.get(target.slotId);
    if (!slot) return;

    // 現在のレシピを一旦外し、過剰カテゴリを避けた候補から選び直す。
    const current = byId.get(target.recipeId);
    used.delete(target.recipeId);
    const mealUsed = slot.mealId === undefined ? new Set<string>() : usedByMeal.get(slot.mealId);
    mealUsed?.delete(target.recipeId);
    const idx = selected.findIndex((r) => r.id === target.recipeId);
    if (idx >= 0) selected.splice(idx, 1);

    const { candidates } = buildCandidates(
      slot,
      input.recipes,
      used,
      mealUsed ?? new Set<string>(),
      excluded,
      input.referenceDate,
      settings,
    );
    const avoiding = candidates.filter(
      (r) => r.id !== target.recipeId && r.mainIngredientCategory !== overused,
    );
    const pool = avoiding.length > 0 ? avoiding : candidates;
    const pick = pickRecipe(
      pool,
      selected,
      input.referenceDate,
      settings,
      rng,
      input.pantryScores,
    );

    // 選び直せなければ元に戻して打ち切り（無限ループ防止）。
    const chosen = pick ?? current ?? null;
    if (chosen) {
      used.add(chosen.id);
      mealUsed?.add(chosen.id);
      selected.push(chosen);
      target.recipeId = chosen.id;
    }
    if (!pick || pick.mainIngredientCategory === overused) return;
  }
}
