import { describe, expect, it } from "vitest";
import { isInternalHost, isPrivateIpv4, validateExternalUrl } from "./url.ts";

describe("isPrivateIpv4", () => {
  it("flags private and reserved ranges", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "192.168.1.1", "172.16.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0"]) {
      expect(isPrivateIpv4(ip)).toBe(true);
    }
  });

  it("allows public IPs", () => {
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv4("172.32.0.1")).toBe(false); // just outside 172.16/12
  });
});

describe("isInternalHost", () => {
  it("flags localhost and reserved suffixes", () => {
    expect(isInternalHost("localhost")).toBe(true);
    expect(isInternalHost("foo.local")).toBe(true);
    expect(isInternalHost("db.internal")).toBe(true);
    expect(isInternalHost("::1")).toBe(true);
  });

  it("allows normal hosts", () => {
    expect(isInternalHost("example.com")).toBe(false);
    expect(isInternalHost("www.youtube.com")).toBe(false);
  });
});

describe("validateExternalUrl", () => {
  it("accepts public http/https URLs", () => {
    expect(validateExternalUrl("https://example.com/recipe")).toEqual({
      ok: true,
      href: "https://example.com/recipe",
    });
  });

  it("rejects internal addresses", () => {
    expect(validateExternalUrl("http://localhost:8000/x").ok).toBe(false);
    expect(validateExternalUrl("http://192.168.0.5/").ok).toBe(false);
    expect(validateExternalUrl("http://169.254.169.254/latest/meta-data").ok).toBe(false);
  });

  it("rejects non-http schemes", () => {
    expect(validateExternalUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateExternalUrl("ftp://example.com").ok).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(validateExternalUrl("not a url").ok).toBe(false);
  });
});
