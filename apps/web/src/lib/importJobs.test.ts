import { describe, expect, it } from "vitest";
import { isStalled, STALL_THRESHOLD_MS, type ImportJobRow } from "./importJobs.ts";

const NOW = new Date("2026-08-16T12:00:00Z");

const job = (partial: Partial<ImportJobRow> = {}): ImportJobRow => ({
  id: "job-1",
  url: "https://example.com/recipe/1",
  status: "pending",
  recipe_id: null,
  error: null,
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  ...partial,
});

const minutesBefore = (m: number) => new Date(NOW.getTime() - m * 60 * 1000).toISOString();

describe("isStalled", () => {
  it("is false for a job that just started", () => {
    expect(isStalled(job({ created_at: minutesBefore(1) }), NOW)).toBe(false);
  });

  it("is true once a pending job passes the threshold", () => {
    expect(isStalled(job({ created_at: minutesBefore(11) }), NOW)).toBe(true);
    expect(STALL_THRESHOLD_MS).toBe(600000);
  });

  it("is false exactly at the threshold", () => {
    expect(isStalled(job({ created_at: minutesBefore(10) }), NOW)).toBe(false);
  });

  it("only applies to pending jobs", () => {
    const old = minutesBefore(60);
    expect(isStalled(job({ status: "success", created_at: old }), NOW)).toBe(false);
    expect(isStalled(job({ status: "failed", created_at: old }), NOW)).toBe(false);
    expect(isStalled(job({ status: "partial", created_at: old }), NOW)).toBe(false);
  });
});
