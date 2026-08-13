import { describe, expect, it, vi } from "vitest";

vi.mock("../main.js", () => ({ prisma: {} }));

import {
  parseTimezoneOffsetQuery,
  resolveTimezoneInput,
  searchTimezones,
} from "./userPreferences.js";

describe("parseTimezoneOffsetQuery", () => {
  it("parses GMT/UTC offset forms", () => {
    expect(parseTimezoneOffsetQuery("GMT+10")).toBe(10 * 60);
    expect(parseTimezoneOffsetQuery("gmt+10")).toBe(10 * 60);
    expect(parseTimezoneOffsetQuery("UTC-5")).toBe(-5 * 60);
    expect(parseTimezoneOffsetQuery("utc+10:00")).toBe(10 * 60);
    expect(parseTimezoneOffsetQuery("GMT +10")).toBe(10 * 60);
  });

  it("parses bare offsets", () => {
    expect(parseTimezoneOffsetQuery("+10")).toBe(10 * 60);
    expect(parseTimezoneOffsetQuery("+10:00")).toBe(10 * 60);
    expect(parseTimezoneOffsetQuery("-10:00")).toBe(-10 * 60);
    expect(parseTimezoneOffsetQuery("+0530")).toBe(5 * 60 + 30);
  });

  it("rejects non-offset queries", () => {
    expect(parseTimezoneOffsetQuery("Sydney")).toBeNull();
    expect(parseTimezoneOffsetQuery("America/New_York")).toBeNull();
    expect(parseTimezoneOffsetQuery("EST")).toBeNull();
  });
});

describe("resolveTimezoneInput", () => {
  it("accepts IANA ids", () => {
    expect(resolveTimezoneInput("America/New_York")).toBe("America/New_York");
    expect(resolveTimezoneInput("australia/sydney")).toBe("Australia/Sydney");
  });

  it("resolves GMT/UTC aliases to fixed offsets", () => {
    expect(resolveTimezoneInput("GMT+10")).toBe("+10:00");
    expect(resolveTimezoneInput("UTC-5")).toBe("-05:00");
    expect(resolveTimezoneInput("+10")).toBe("+10");
  });

  it("accepts common abbreviations Intl supports", () => {
    expect(resolveTimezoneInput("EST")).toBe("EST");
    expect(resolveTimezoneInput("gmt")).toBe("gmt");
  });

  it("rejects garbage", () => {
    expect(resolveTimezoneInput("not-a-zone")).toBeNull();
    expect(resolveTimezoneInput("")).toBeNull();
  });
});

describe("searchTimezones", () => {
  it("matches IANA path fragments", () => {
    const results = searchTimezones("Sydney");
    expect(results).toContain("Australia/Sydney");
  });

  it("matches GMT+10 style offsets to current zones", () => {
    const results = searchTimezones("GMT+10");
    expect(results.length).toBeGreaterThan(0);
    expect(results).toContain("+10:00");
    expect(
      results.some(
        (tz) =>
          tz.includes("Australia/") ||
          tz.includes("Pacific/") ||
          tz.includes("Asia/") ||
          tz.startsWith("Etc/"),
      ),
    ).toBe(true);
  });

  it("matches UTC-5 style offsets", () => {
    const results = searchTimezones("UTC-5");
    expect(results.length).toBeGreaterThan(0);
    expect(results).toContain("-05:00");
  });

  it("matches abbreviations like EST", () => {
    const results = searchTimezones("EST");
    expect(results.length).toBeGreaterThan(0);
  });
});
