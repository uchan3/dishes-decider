import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase.ts", () => ({ isSupabaseConfigured: true, supabase: {} }));

import { db } from "../db/schema.ts";
import { DEFAULT_WEEKDAY_TEMPLATES, type WeekdayTemplates } from "./mealTemplates.ts";
import {
  DEFAULT_PLANNING_SETTINGS,
  loadPlanningSettings,
  loadWeekdayTemplates,
  savePlanningSettings,
  saveWeekdayTemplates,
  settingsUpdatedAt,
} from "./settings.ts";
import {
  applySettingsDocument,
  buildSettingsDocument,
  shouldApplySettings,
  type SettingsDocument,
} from "./settingsSync.ts";

const EARLY = "2026-09-14T09:00:00.000Z";
const LATE = "2026-09-14T10:00:00.000Z";

const ALL_ONE_DISH = Array(7).fill("one_dish") as WeekdayTemplates;

const remoteDoc = (updatedAt: string, overrides: Partial<SettingsDocument> = {}): SettingsDocument => ({
  updatedAt,
  weekdayTemplates: ALL_ONE_DISH,
  planning: { ...DEFAULT_PLANNING_SETTINGS, householdSize: 4 },
  ...overrides,
});

describe("shouldApplySettings", () => {
  it("accepts a remote change when we have never touched settings", () => {
    expect(shouldApplySettings("", LATE)).toBe(true);
  });

  it("accepts a newer remote change", () => {
    expect(shouldApplySettings(EARLY, LATE)).toBe(true);
  });

  it("keeps ours when the remote is older or the same", () => {
    expect(shouldApplySettings(LATE, EARLY)).toBe(false);
    expect(shouldApplySettings(LATE, LATE)).toBe(false);
  });

  it("ignores a document with no clock", () => {
    expect(shouldApplySettings(EARLY, "")).toBe(false);
  });
});

describe("settings document", () => {
  beforeEach(async () => {
    await Promise.all([db.settings.clear(), db.outbox.clear()]);
  });

  it("builds a document from what is stored locally", async () => {
    await savePlanningSettings({ ...DEFAULT_PLANNING_SETTINGS, householdSize: 3 });

    const doc = await buildSettingsDocument();

    expect(doc.planning.householdSize).toBe(3);
    expect(doc.weekdayTemplates).toEqual(DEFAULT_WEEKDAY_TEMPLATES);
    expect(doc.updatedAt).not.toBe("");
  });

  it("queues the document whenever settings are saved", async () => {
    await saveWeekdayTemplates(ALL_ONE_DISH);

    const queued = await db.outbox.toArray();
    expect(queued.map((row) => [row.table_name, row.record_id, row.op])).toEqual([
      ["settingsDoc", "settings", "put"],
    ]);
  });

  it("applies a newer document from the other device", async () => {
    await savePlanningSettings({ ...DEFAULT_PLANNING_SETTINGS, householdSize: 2 });
    await db.settings.put({ key: "settings_updated_at", value: EARLY });

    expect(await applySettingsDocument(remoteDoc(LATE))).toBe(true);
    expect((await loadPlanningSettings()).householdSize).toBe(4);
    expect(await loadWeekdayTemplates()).toEqual(ALL_ONE_DISH);
  });

  it("keeps ours when the incoming document is older", async () => {
    await savePlanningSettings({ ...DEFAULT_PLANNING_SETTINGS, householdSize: 2 });
    await db.settings.put({ key: "settings_updated_at", value: LATE });

    expect(await applySettingsDocument(remoteDoc(EARLY))).toBe(false);
    expect((await loadPlanningSettings()).householdSize).toBe(2);
  });

  it("adopts the sender's clock, so the value is not sent straight back", async () => {
    await applySettingsDocument(remoteDoc(LATE));

    expect(await settingsUpdatedAt()).toBe(LATE);
  });

  it("does not queue anything for a document it just received", async () => {
    await applySettingsDocument(remoteDoc(LATE));

    expect(await db.outbox.count()).toBe(0);
  });

  it("sanitises a broken document instead of feeding it to generation", async () => {
    const broken = remoteDoc(LATE, {
      weekdayTemplates: ["nope", "standard", "standard", "standard", "standard", "standard", "standard"] as unknown as WeekdayTemplates,
      planning: { householdSize: 0, cooldownDays: -5 } as never,
    });

    await applySettingsDocument(broken);

    // 壊れた枠だけが既定に落ち、正しい枠はそのまま残る。
    const templates = await loadWeekdayTemplates();
    expect(templates[0]).toBe(DEFAULT_WEEKDAY_TEMPLATES[0]);
    expect(templates.slice(1)).toEqual(Array(6).fill("standard"));
    const planning = await loadPlanningSettings();
    expect(planning.householdSize).toBe(1); // 最小値に丸められる
    expect(planning.cooldownDays).toBe(0);
  });
});
