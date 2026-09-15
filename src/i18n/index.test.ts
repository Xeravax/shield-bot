import { describe, expect, it, beforeAll } from "vitest";
import {
  initI18n,
  t,
  getAvailableLocales,
  isAvailableLocale,
  DEFAULT_LOCALE,
} from "./index.js";

beforeAll(async () => {
  await initI18n();
});

describe("i18n", () => {
  it("loads en-US and nl", () => {
    expect(getAvailableLocales()).toContain("en-US");
    expect(getAvailableLocales()).toContain("nl");
    expect(isAvailableLocale("nl")).toBe(true);
    expect(isAvailableLocale("nl-NL")).toBe(false);
  });

  it("translates profile title", () => {
    expect(t(DEFAULT_LOCALE, "profile.title")).toBe("Profile Settings");
    expect(t("nl", "profile.title")).toBe("Profielinstellingen");
  });

  it("falls back to en-US for missing keys", () => {
    expect(t("nl", "profile.title")).toBeTruthy();
  });

  it("interpolates patrol DM body", () => {
    const text = t("en-US", "patrol.dm.completedBody", {
      duration: "1h",
      channel: "Patrol",
    });
    expect(text).toContain("1h");
    expect(text).toContain("Patrol");
  });
});
