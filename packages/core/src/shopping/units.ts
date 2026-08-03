/**
 * 単位の分類と換算（仕様書 §5.3）。
 *
 * 買い物リストの合算は「同系統の単位のみ」行う。系統をまたぐ量（例: g と個）や
 * 曖昧量（適量・少々）は合算せず併記する。
 *
 *   - 重量系: g / kg            → g に換算
 *   - 容量系: ml / cc / L / 大さじ(15ml) / 小さじ(5ml) / カップ(200ml) → ml に換算
 *   - 個数系: 個 / 本 / 枚 / 束 / パック 等 → 合算するが単位は保持
 *   - 曖昧量: 適量 / 少々 / お好みで → 合算しない
 */

/** 単位の系統。 */
export type UnitSystem = "weight" | "volume" | "count" | "ambiguous";

/** 単位の分類結果。 */
export interface UnitInfo {
  system: UnitSystem;
  /** weight/volume: base 単位への換算係数。count: 1。ambiguous: 0。 */
  toBase: number;
  /** 正規化後の表示単位（weight→'g' / volume→'ml' / count→元の単位 / ambiguous→null）。 */
  baseUnit: string | null;
}

/** 重量系の単位 → g への係数。 */
const WEIGHT_UNITS: Record<string, number> = {
  g: 1,
  グラム: 1,
  kg: 1000,
  キロ: 1000,
  キログラム: 1000,
};

/** 容量系の単位 → ml への係数。 */
const VOLUME_UNITS: Record<string, number> = {
  ml: 1,
  cc: 1,
  ミリリットル: 1,
  l: 1000,
  L: 1000,
  リットル: 1000,
  大さじ: 15,
  小さじ: 5,
  カップ: 200,
};

/** 合算しない曖昧量の語。 */
const AMBIGUOUS_UNITS: ReadonlySet<string> = new Set([
  "適量",
  "少々",
  "お好みで",
  "適宜",
  "ひとつまみ",
  "少量",
]);

/** 単位文字列を正規化（前後空白・全角空白除去）。 */
function normalizeUnit(unit: string): string {
  return unit.replace(/[\s　]/g, "").trim();
}

/**
 * 単位を分類し、換算情報を返す。
 *
 * `unit` が null（＝数量のみ・単位なし）や既知の曖昧語の場合は `ambiguous` を返す。
 * 未知の単位は個数系（`count`、単位を保持）として扱い、同一単位どうしのみ合算する。
 *
 * @example
 * ```ts
 * classifyUnit("大さじ"); // { system: "volume", toBase: 15, baseUnit: "ml" }
 * classifyUnit("本");     // { system: "count", toBase: 1, baseUnit: "本" }
 * classifyUnit("適量");   // { system: "ambiguous", toBase: 0, baseUnit: null }
 * ```
 */
export function classifyUnit(unit: string | null): UnitInfo {
  if (unit === null) return { system: "ambiguous", toBase: 0, baseUnit: null };
  const u = normalizeUnit(unit);
  if (u === "" || AMBIGUOUS_UNITS.has(u)) {
    return { system: "ambiguous", toBase: 0, baseUnit: null };
  }
  if (u in WEIGHT_UNITS) {
    return { system: "weight", toBase: WEIGHT_UNITS[u] as number, baseUnit: "g" };
  }
  if (u in VOLUME_UNITS) {
    return { system: "volume", toBase: VOLUME_UNITS[u] as number, baseUnit: "ml" };
  }
  return { system: "count", toBase: 1, baseUnit: u };
}
