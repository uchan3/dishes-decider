import { describe, expect, it } from "vitest";
import {
  extractRecipeFromJsonLd,
  mapJsonLdRecipe,
  parseIsoDurationToMinutes,
  parseServings,
} from "./jsonld.ts";

describe("parseIsoDurationToMinutes", () => {
  it("parses hours and minutes", () => {
    expect(parseIsoDurationToMinutes("PT1H30M")).toBe(90);
    expect(parseIsoDurationToMinutes("PT20M")).toBe(20);
    expect(parseIsoDurationToMinutes("PT2H")).toBe(120);
  });

  it("returns null for invalid input", () => {
    expect(parseIsoDurationToMinutes("20 minutes")).toBeNull();
    expect(parseIsoDurationToMinutes(null)).toBeNull();
    expect(parseIsoDurationToMinutes("PT0M")).toBeNull();
  });
});

describe("parseServings", () => {
  it("extracts a number from strings and numbers", () => {
    expect(parseServings("4人分")).toBe(4);
    expect(parseServings("2")).toBe(2);
    expect(parseServings(3)).toBe(3);
    expect(parseServings(["6 servings"])).toBe(6);
  });

  it("returns null when no number is present", () => {
    expect(parseServings("たっぷり")).toBeNull();
    expect(parseServings(null)).toBeNull();
  });
});

describe("mapJsonLdRecipe", () => {
  it("maps name, ingredients, and instructions", () => {
    const { result, originalStepTexts } = mapJsonLdRecipe({
      "@type": "Recipe",
      name: "肉じゃが",
      recipeIngredient: ["牛こま切れ肉 200g", "じゃがいも 3個"],
      recipeInstructions: [
        { "@type": "HowToStep", text: "材料を切る" },
        { "@type": "HowToStep", text: "鍋で煮込む" },
      ],
      totalTime: "PT40M",
      recipeYield: "4人分",
    });
    expect(result.title).toBe("肉じゃが");
    expect(result.ingredients).toHaveLength(2);
    expect(result.ingredients[0]?.rawText).toBe("牛こま切れ肉 200g");
    expect(result.cookTimeMin).toBe(40);
    expect(result.servings).toBe(4);
    // 手順の summary はゲート前なので null、原文は originalStepTexts に。
    expect(result.steps.map((s) => s.summary)).toEqual([null, null]);
    expect(originalStepTexts).toEqual({ 1: "材料を切る", 2: "鍋で煮込む" });
  });

  it("handles plain-string and HowToSection instructions", () => {
    const { originalStepTexts } = mapJsonLdRecipe({
      "@type": "Recipe",
      name: "test",
      recipeInstructions: [
        "まず下ごしらえ",
        { "@type": "HowToSection", itemListElement: [{ "@type": "HowToStep", text: "炒める" }] },
      ],
    });
    expect(originalStepTexts).toEqual({ 1: "まず下ごしらえ", 2: "炒める" });
  });
});

describe("extractRecipeFromJsonLd", () => {
  it("finds a Recipe inside an @graph block", () => {
    const block = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "site" },
        { "@type": "Recipe", name: "カレー", recipeIngredient: ["玉ねぎ 1個"] },
      ],
    });
    const extraction = extractRecipeFromJsonLd([block]);
    expect(extraction?.result.title).toBe("カレー");
  });

  it("returns null when no Recipe is present", () => {
    const block = JSON.stringify({ "@type": "WebSite", name: "site" });
    expect(extractRecipeFromJsonLd([block])).toBeNull();
  });

  it("skips invalid JSON blocks", () => {
    expect(extractRecipeFromJsonLd(["{ not json", "{}"])).toBeNull();
  });
});
