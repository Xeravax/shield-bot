import { describe, expect, it } from "vitest";
import {
  localeFlagEmoji,
  localeNativeName,
  localePickerLabel,
  regionToFlagEmoji,
} from "./localeDisplay.js";
import { isDiscordLocale } from "./discordLocales.js";

describe("localeDisplay", () => {
  it("maps region codes to flag emoji", () => {
    expect(regionToFlagEmoji("US")).toBe("🇺🇸");
    expect(regionToFlagEmoji("NL")).toBe("🇳🇱");
  });

  it("derives flags from Discord locales", () => {
    expect(localeFlagEmoji("en-US")).toBe("🇺🇸");
    expect(localeFlagEmoji("nl")).toBe("🇳🇱");
    expect(localeFlagEmoji("pt-BR")).toBe("🇧🇷");
    expect(localeFlagEmoji("es-419")).toBe("🌎");
    expect(localeFlagEmoji("zh-TW")).toBe("🇹🇼");
  });

  it("builds picker labels", () => {
    expect(localePickerLabel("nl")).toMatch(/🇳🇱/);
    expect(localeNativeName("nl").length).toBeGreaterThan(0);
  });

  it("validates Discord locales", () => {
    expect(isDiscordLocale("en-US")).toBe(true);
    expect(isDiscordLocale("nl")).toBe(true);
    expect(isDiscordLocale("nl-NL")).toBe(false);
    expect(isDiscordLocale("en")).toBe(false);
  });
});
