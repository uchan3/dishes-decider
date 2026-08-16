import { describe, expect, it } from "vitest";
import { createIngredientIndex, matchIngredientMaster } from "./match.ts";

interface Row {
  id: string;
  canonical_name: string;
  aliases: string[];
}

const keysOf = (m: Row) => [m.canonical_name, ...m.aliases];

const onion: Row = { id: "ing-onion", canonical_name: "玉ねぎ", aliases: ["たまねぎ", "玉葱"] };
const carrot: Row = { id: "ing-carrot", canonical_name: "にんじん", aliases: [] };

describe("matchIngredientMaster", () => {
  it("matches by canonical name regardless of kana form", () => {
    expect(matchIngredientMaster("にんじん", [onion, carrot], keysOf)).toBe(carrot);
    expect(matchIngredientMaster("ニンジン", [onion, carrot], keysOf)).toBe(carrot);
  });

  it("matches via aliases", () => {
    expect(matchIngredientMaster("タマネギ", [onion, carrot], keysOf)).toBe(onion);
    expect(matchIngredientMaster("玉葱", [onion, carrot], keysOf)).toBe(onion);
  });

  it("ignores surrounding whitespace", () => {
    expect(matchIngredientMaster(" 玉ねぎ　", [onion], keysOf)).toBe(onion);
  });

  it("returns undefined for unknown or empty names", () => {
    expect(matchIngredientMaster("ズッキーニ", [onion, carrot], keysOf)).toBeUndefined();
    expect(matchIngredientMaster("  ", [onion], keysOf)).toBeUndefined();
  });
});

describe("createIngredientIndex", () => {
  it("finds masters added after construction", () => {
    const index = createIngredientIndex([onion], keysOf);
    expect(index.match("にんじん")).toBeUndefined();
    index.add(carrot);
    expect(index.match("ニンジン")).toBe(carrot);
  });

  it("keeps the first master when two masters collide on the same key", () => {
    const dup: Row = { id: "ing-dup", canonical_name: "たまねぎ", aliases: [] };
    const index = createIngredientIndex([onion, dup], keysOf);
    expect(index.match("たまねぎ")).toBe(onion);
  });

  it("skips empty keys so blank aliases never match", () => {
    const withBlank: Row = { id: "ing-blank", canonical_name: "塩", aliases: ["", "　"] };
    const index = createIngredientIndex([withBlank], keysOf);
    expect(index.match("")).toBeUndefined();
    expect(index.match("塩")).toBe(withBlank);
  });
});
