import { describe, expect, it } from "vitest";
import { DEFAULT_PLANNING_SETTINGS, normalizePlanningSettings } from "./settings.ts";

describe("normalizePlanningSettings", () => {
  it("falls back to the spec defaults for missing values", () => {
    expect(normalizePlanningSettings(undefined)).toEqual(DEFAULT_PLANNING_SETTINGS);
    expect(normalizePlanningSettings({})).toEqual(DEFAULT_PLANNING_SETTINGS);
    // F-02-1: 平日 30 分・休日は制限なし・クールダウン 14 日
    expect(DEFAULT_PLANNING_SETTINGS.weekdayMaxCookMin).toBe(30);
    expect(DEFAULT_PLANNING_SETTINGS.weekendMaxCookMin).toBeNull();
    expect(DEFAULT_PLANNING_SETTINGS.cooldownDays).toBe(14);
  });

  it("clamps the household size to a sane range", () => {
    expect(normalizePlanningSettings({ householdSize: 0 }).householdSize).toBe(1);
    expect(normalizePlanningSettings({ householdSize: 99 }).householdSize).toBe(12);
    expect(normalizePlanningSettings({ householdSize: 2.4 }).householdSize).toBe(2);
  });

  it("allows disabling the cooldown but not negative values", () => {
    expect(normalizePlanningSettings({ cooldownDays: 0 }).cooldownDays).toBe(0);
    expect(normalizePlanningSettings({ cooldownDays: -5 }).cooldownDays).toBe(0);
  });

  it("treats empty, zero and invalid cook-time limits as no limit", () => {
    expect(normalizePlanningSettings({ weekdayMaxCookMin: "" }).weekdayMaxCookMin).toBeNull();
    expect(normalizePlanningSettings({ weekdayMaxCookMin: null }).weekdayMaxCookMin).toBeNull();
    expect(normalizePlanningSettings({ weekdayMaxCookMin: 0 }).weekdayMaxCookMin).toBeNull();
    expect(normalizePlanningSettings({ weekendMaxCookMin: "abc" }).weekendMaxCookMin).toBeNull();
  });

  it("keeps valid cook-time limits and caps absurd ones", () => {
    expect(normalizePlanningSettings({ weekdayMaxCookMin: 45 }).weekdayMaxCookMin).toBe(45);
    expect(normalizePlanningSettings({ weekendMaxCookMin: 9999 }).weekendMaxCookMin).toBe(600);
  });

  it("ignores non-object stored values", () => {
    expect(normalizePlanningSettings("broken")).toEqual(DEFAULT_PLANNING_SETTINGS);
    expect(normalizePlanningSettings(null)).toEqual(DEFAULT_PLANNING_SETTINGS);
  });
});
