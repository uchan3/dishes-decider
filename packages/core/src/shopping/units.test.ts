import { describe, expect, it } from "vitest";
import { classifyUnit } from "./units.ts";

describe("classifyUnit", () => {
  it("classifies weight units and converts to grams", () => {
    expect(classifyUnit("g")).toEqual({ system: "weight", toBase: 1, baseUnit: "g" });
    expect(classifyUnit("kg")).toEqual({ system: "weight", toBase: 1000, baseUnit: "g" });
  });

  it("classifies volume units and converts to millilitres", () => {
    expect(classifyUnit("大さじ")).toEqual({ system: "volume", toBase: 15, baseUnit: "ml" });
    expect(classifyUnit("小さじ")).toEqual({ system: "volume", toBase: 5, baseUnit: "ml" });
    expect(classifyUnit("カップ")).toEqual({ system: "volume", toBase: 200, baseUnit: "ml" });
    expect(classifyUnit("L")).toEqual({ system: "volume", toBase: 1000, baseUnit: "ml" });
  });

  it("treats count units as count while preserving the unit", () => {
    expect(classifyUnit("本")).toEqual({ system: "count", toBase: 1, baseUnit: "本" });
    expect(classifyUnit("個")).toEqual({ system: "count", toBase: 1, baseUnit: "個" });
  });

  it("treats ambiguous words and null/empty units as ambiguous", () => {
    expect(classifyUnit("適量").system).toBe("ambiguous");
    expect(classifyUnit("少々").system).toBe("ambiguous");
    expect(classifyUnit(null).system).toBe("ambiguous");
    expect(classifyUnit("  ").system).toBe("ambiguous");
  });

  it("ignores surrounding whitespace", () => {
    expect(classifyUnit(" g ")).toMatchObject({ system: "weight", baseUnit: "g" });
  });
});
