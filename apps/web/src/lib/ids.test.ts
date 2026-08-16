import { describe, expect, it } from "vitest";
import { isUuid, newId } from "./ids.ts";

describe("isUuid", () => {
  it("accepts generated ids", () => {
    expect(isUuid(newId())).toBe(true);
  });

  it("accepts uppercase and any version digit", () => {
    expect(isUuid("A1B2C3D4-E5F6-7A8B-9C0D-E1F2A3B4C5D6")).toBe(true);
  });

  it("rejects local-only ids used by the dev seed", () => {
    expect(isUuid("src-manual")).toBe(false);
    expect(isUuid("ing-onion")).toBe(false);
    expect(isUuid("plan-2026-08-17")).toBe(false);
    expect(isUuid("")).toBe(false);
  });

  it("rejects strings that merely contain a uuid", () => {
    expect(isUuid(` ${newId()} `)).toBe(false);
    expect(isUuid(`list-${newId()}`)).toBe(false);
  });
});
