/**
 * 食材名から売場カテゴリと常備品フラグを推定する（仕様書 §5.3 / F-03-1）。
 *
 * 取り込み時に新しい食材マスタを作るとき、カテゴリが決まらないと買い物リストが
 * すべて「その他」に落ち、売場順ソートと常備品除外（US-10）が機能しない。LLM に
 * 毎回聞くとコストと揺れが増えるため、決定論的な辞書マッチで推定する。
 *
 * 判定は {@link normalizeIngredientName} の正規化キー（カタカナ→ひらがな・空白除去）に対する
 * 部分一致で、**最長一致を優先**する。これにより「ごま油」は調味料、「ごま」は乾物、
 * 「油揚げ」は加工食品、と長い語が短い語に勝つ。同じ長さで競合した場合は辞書の登録順
 * （食材 → 調味料）が優先される。
 *
 * 分類の指針:
 *   - 豆腐・納豆・油揚げ・こんにゃく等の加工食品は `dry_goods`（売場導線が乾物に近いため）
 *   - 果物は `vegetable`（青果売場でまとまるため）
 *   - 「冷凍」で始まる名前は中身によらず `frozen`
 */

import type { IngredientCategory } from "../types/index.ts";
import { normalizeIngredientName } from "./name.ts";

/** 推定結果。 */
export interface IngredientClassification {
  category: IngredientCategory;
  /** 常備品（塩・醤油等）。買い物リストからデフォルト除外される。 */
  isPantryStaple: boolean;
}

/** 辞書の 1 エントリ。`[語, カテゴリ, 常備品か]`。 */
type Entry = readonly [string, IngredientCategory, boolean?];

/**
 * 食材キーワード辞書。
 *
 * 食材（野菜・肉・魚・乳卵・乾物）を先に、調味料を後ろに置く。同じ長さの語が競合した
 * ときに食材側が勝つようにするため、この順序には意味がある（例: 「塩鮭」の「塩」と「鮭」）。
 */
const ENTRIES: readonly Entry[] = [
  // ---- 野菜・きのこ・果物 ----
  ["玉ねぎ", "vegetable"],
  ["たまねぎ", "vegetable"],
  ["玉葱", "vegetable"],
  ["にんじん", "vegetable"],
  ["人参", "vegetable"],
  ["じゃがいも", "vegetable"],
  ["じゃが芋", "vegetable"],
  ["さつまいも", "vegetable"],
  ["さといも", "vegetable"],
  ["里芋", "vegetable"],
  ["長芋", "vegetable"],
  ["キャベツ", "vegetable"],
  ["レタス", "vegetable"],
  ["白菜", "vegetable"],
  ["はくさい", "vegetable"],
  ["大根", "vegetable"],
  ["だいこん", "vegetable"],
  ["かぶ", "vegetable"],
  ["長ねぎ", "vegetable"],
  ["青ねぎ", "vegetable"],
  ["小ねぎ", "vegetable"],
  ["万能ねぎ", "vegetable"],
  ["ねぎ", "vegetable"],
  ["にら", "vegetable"],
  ["ピーマン", "vegetable"],
  ["パプリカ", "vegetable"],
  ["なす", "vegetable"],
  ["茄子", "vegetable"],
  ["ミニトマト", "vegetable"],
  ["トマト", "vegetable"],
  ["きゅうり", "vegetable"],
  ["もやし", "vegetable"],
  ["ほうれん草", "vegetable"],
  ["ほうれんそう", "vegetable"],
  ["小松菜", "vegetable"],
  ["春菊", "vegetable"],
  ["水菜", "vegetable"],
  ["ブロッコリー", "vegetable"],
  ["カリフラワー", "vegetable"],
  ["かぼちゃ", "vegetable"],
  ["南瓜", "vegetable"],
  ["ごぼう", "vegetable"],
  ["れんこん", "vegetable"],
  ["蓮根", "vegetable"],
  ["とうもろこし", "vegetable"],
  ["ズッキーニ", "vegetable"],
  ["セロリ", "vegetable"],
  ["アスパラ", "vegetable"],
  ["オクラ", "vegetable"],
  ["枝豆", "vegetable"],
  ["いんげん", "vegetable"],
  ["ししとう", "vegetable"],
  ["きのこ", "vegetable"],
  ["しめじ", "vegetable"],
  ["えのき", "vegetable"],
  ["しいたけ", "vegetable"],
  ["椎茸", "vegetable"],
  ["まいたけ", "vegetable"],
  ["舞茸", "vegetable"],
  ["エリンギ", "vegetable"],
  ["マッシュルーム", "vegetable"],
  ["なめこ", "vegetable"],
  ["にんにく", "vegetable"],
  ["生姜", "vegetable"],
  ["しょうが", "vegetable"],
  ["大葉", "vegetable"],
  ["しそ", "vegetable"],
  ["パセリ", "vegetable"],
  ["みょうが", "vegetable"],
  ["かいわれ", "vegetable"],
  // 「貝割れ」は「貝」(seafood) を含むため、漢字表記も明示的に登録する。
  ["貝割れ", "vegetable"],
  ["三つ葉", "vegetable"],
  ["みつば", "vegetable"],
  ["アボカド", "vegetable"],
  ["レモン", "vegetable"],
  ["りんご", "vegetable"],
  ["バナナ", "vegetable"],
  ["いちご", "vegetable"],
  ["みかん", "vegetable"],
  ["すいか", "vegetable"],

  // ---- 肉 ----
  ["合いびき肉", "meat"],
  ["合い挽き肉", "meat"],
  ["ひき肉", "meat"],
  ["挽き肉", "meat"],
  ["ミンチ", "meat"],
  ["鶏むね", "meat"],
  ["鶏もも", "meat"],
  ["ささみ", "meat"],
  ["手羽先", "meat"],
  ["手羽元", "meat"],
  ["豚バラ", "meat"],
  ["豚こま", "meat"],
  ["ベーコン", "meat"],
  ["ソーセージ", "meat"],
  ["ウインナー", "meat"],
  ["ラム肉", "meat"],
  ["ハム", "meat"],
  ["豚", "meat"],
  ["鶏", "meat"],
  ["牛", "meat"],
  ["肉", "meat"],

  // ---- 魚介 ----
  ["白身魚", "seafood"],
  ["サーモン", "seafood"],
  ["まぐろ", "seafood"],
  ["いわし", "seafood"],
  ["さんま", "seafood"],
  ["秋刀魚", "seafood"],
  ["あさり", "seafood"],
  ["しじみ", "seafood"],
  ["ほたて", "seafood"],
  ["しらす", "seafood"],
  ["明太子", "seafood"],
  ["たらこ", "seafood"],
  ["ちくわ", "seafood"],
  ["はんぺん", "seafood"],
  ["かまぼこ", "seafood"],
  ["かつお", "seafood"],
  ["海老", "seafood"],
  ["刺身", "seafood"],
  ["ツナ", "seafood"],
  ["えび", "seafood"],
  ["いか", "seafood"],
  ["たこ", "seafood"],
  ["さば", "seafood"],
  ["さけ", "seafood"],
  ["ぶり", "seafood"],
  ["たら", "seafood"],
  ["あじ", "seafood"],
  ["鮭", "seafood"],
  ["鯖", "seafood"],
  ["鰤", "seafood"],
  ["鱈", "seafood"],
  ["鮪", "seafood"],
  ["鰯", "seafood"],
  ["貝", "seafood"],
  ["魚", "seafood"],

  // ---- 乳製品・卵 ----
  ["クリームチーズ", "dairy_egg"],
  ["生クリーム", "dairy_egg"],
  ["ヨーグルト", "dairy_egg"],
  ["牛乳", "dairy_egg"],
  ["豆乳", "dairy_egg"],
  ["練乳", "dairy_egg"],
  ["ミルク", "dairy_egg"],
  ["チーズ", "dairy_egg"],
  ["バター", "dairy_egg"],
  ["たまご", "dairy_egg"],
  ["玉子", "dairy_egg"],
  ["卵", "dairy_egg"],

  // ---- 乾物・粉類・加工食品 ----
  ["コーンスターチ", "dry_goods", true],
  ["スパゲッティ", "dry_goods"],
  ["餃子の皮", "dry_goods"],
  ["春巻きの皮", "dry_goods"],
  ["高野豆腐", "dry_goods"],
  ["こんにゃく", "dry_goods"],
  ["しらたき", "dry_goods"],
  ["ひよこ豆", "dry_goods"],
  ["かつお節", "dry_goods"],
  ["鰹節", "dry_goods"],
  ["天ぷら粉", "dry_goods", true],
  ["てんぷら粉", "dry_goods", true],
  ["薄力粉", "dry_goods", true],
  ["強力粉", "dry_goods", true],
  ["小麦粉", "dry_goods", true],
  ["片栗粉", "dry_goods", true],
  ["パン粉", "dry_goods", true],
  ["マカロニ", "dry_goods"],
  ["ラーメン", "dry_goods"],
  ["そうめん", "dry_goods"],
  ["中華麺", "dry_goods"],
  ["油揚げ", "dry_goods"],
  ["厚揚げ", "dry_goods"],
  ["パスタ", "dry_goods"],
  ["うどん", "dry_goods"],
  ["食パン", "dry_goods"],
  ["わかめ", "dry_goods"],
  ["ひじき", "dry_goods"],
  ["春雨", "dry_goods"],
  ["昆布", "dry_goods"],
  ["大豆", "dry_goods"],
  ["豆腐", "dry_goods"],
  ["納豆", "dry_goods"],
  ["白米", "dry_goods"],
  ["ご飯", "dry_goods"],
  ["ごはん", "dry_goods"],
  ["缶詰", "dry_goods"],
  ["海苔", "dry_goods"],
  ["ごま", "dry_goods", true],
  ["そば", "dry_goods"],
  ["のり", "dry_goods"],
  ["麩", "dry_goods"],
  ["米", "dry_goods"],

  // ---- 調味料（原則すべて常備品扱い） ----
  ["鶏がらスープの素", "seasoning", true],
  ["鶏がらスープ", "seasoning", true],
  ["オイスターソース", "seasoning", true],
  ["ウスターソース", "seasoning", true],
  ["オリーブオイル", "seasoning", true],
  ["オリーブ油", "seasoning", true],
  ["七味唐辛子", "seasoning", true],
  ["一味唐辛子", "seasoning", true],
  ["中濃ソース", "seasoning", true],
  ["焼肉のたれ", "seasoning", true],
  ["コチュジャン", "seasoning", true],
  ["ナンプラー", "seasoning", true],
  ["マヨネーズ", "seasoning", true],
  ["ケチャップ", "seasoning", true],
  ["だしの素", "seasoning", true],
  ["顆粒だし", "seasoning", true],
  ["和風だし", "seasoning", true],
  ["コンソメ", "seasoning", true],
  ["カレー粉", "seasoning", true],
  ["豆板醤", "seasoning", true],
  ["甜麺醤", "seasoning", true],
  ["めんつゆ", "seasoning", true],
  ["白だし", "seasoning", true],
  ["ポン酢", "seasoning", true],
  ["サラダ油", "seasoning", true],
  ["ごま油", "seasoning", true],
  ["ラー油", "seasoning", true],
  ["米油", "seasoning", true],
  ["米酢", "seasoning", true],
  ["穀物酢", "seasoning", true],
  ["料理酒", "seasoning", true],
  ["日本酒", "seasoning", true],
  ["こしょう", "seasoning", true],
  ["胡椒", "seasoning", true],
  ["醤油", "seasoning", true],
  ["しょうゆ", "seasoning", true],
  ["味噌", "seasoning", true],
  ["みそ", "seasoning", true],
  ["砂糖", "seasoning", true],
  ["さとう", "seasoning", true],
  ["みりん", "seasoning", true],
  ["はちみつ", "seasoning", true],
  ["蜂蜜", "seasoning", true],
  ["唐辛子", "seasoning", true],
  ["塩", "seasoning", true],
  ["しお", "seasoning", true],
  ["酢", "seasoning", true],
  ["酒", "seasoning", true],
  ["油", "seasoning", true],
];

/** 正規化済みキーワード（長い順）。同長は {@link ENTRIES} の登録順を保つ。 */
const NORMALIZED: readonly (readonly [string, IngredientCategory, boolean])[] = ENTRIES.map(
  ([word, category, pantry]) =>
    [normalizeIngredientName(word), category, pantry ?? false] as const,
).sort((a, b) => b[0].length - a[0].length);

/** 「冷凍◯◯」は中身によらず冷凍売場に置く。 */
const FROZEN_PREFIX = normalizeIngredientName("冷凍");

const UNKNOWN: IngredientClassification = { category: "other", isPantryStaple: false };

/**
 * 食材名から売場カテゴリと常備品フラグを推定する。
 *
 * 辞書に無ければ `{ category: "other", isPantryStaple: false }` を返す（誤分類より
 * 「その他」に落とす方が安全。ユーザーが後から食材マスタで直せる）。
 *
 * @param name - 食材の表示名（例: 「玉ねぎ」「豚バラ肉」「ごま油」）
 *
 * @example
 * ```ts
 * classifyIngredient("タマネギ");   // { category: "vegetable", isPantryStaple: false }
 * classifyIngredient("ごま油");     // { category: "seasoning", isPantryStaple: true }
 * classifyIngredient("冷凍うどん"); // { category: "frozen",    isPantryStaple: false }
 * ```
 */
export function classifyIngredient(name: string): IngredientClassification {
  const key = normalizeIngredientName(name);
  if (key === "") return UNKNOWN;
  if (key.startsWith(FROZEN_PREFIX)) return { category: "frozen", isPantryStaple: false };

  for (const [word, category, isPantryStaple] of NORMALIZED) {
    if (key.includes(word)) return { category, isPantryStaple };
  }
  return UNKNOWN;
}
