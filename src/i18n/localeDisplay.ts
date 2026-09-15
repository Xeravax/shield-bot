import {
  DISCORD_LOCALES,
  LANGUAGE_DEFAULT_REGION,
  LOCALE_FLAG_OVERRIDE,
  type DiscordLocale,
} from "./discordLocales.js";

/** Convert ISO 3166-1 alpha-2 to regional-indicator flag emoji. */
export function regionToFlagEmoji(region: string): string {
  const code = region.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    return "🏳️";
  }
  const A = 0x1f1e6;
  return String.fromCodePoint(
    A + (code.charCodeAt(0) - 65),
    A + (code.charCodeAt(1) - 65),
  );
}

/**
 * Derive a display flag for a Discord locale.
 * Region subtag → flag; language-only → default country; es-419 → 🌎.
 */
export function localeFlagEmoji(locale: string): string {
  if (LOCALE_FLAG_OVERRIDE[locale]) {
    return LOCALE_FLAG_OVERRIDE[locale];
  }
  const parts = locale.split("-");
  if (parts.length >= 2) {
    const region = parts[parts.length - 1];
    // es-419 handled above; numeric regions skip
    if (/^[A-Za-z]{2}$/.test(region)) {
      return regionToFlagEmoji(region);
    }
  }
  const fallbackRegion = LANGUAGE_DEFAULT_REGION[parts[0]];
  if (fallbackRegion) {
    return regionToFlagEmoji(fallbackRegion);
  }
  return "🏳️";
}

/** Native language name for picker labels (e.g. "Nederlands"). */
export function localeNativeName(locale: string): string {
  try {
    const dn = new Intl.DisplayNames([locale], { type: "language" });
    const name = dn.of(locale) ?? dn.of(locale.split("-")[0]);
    if (name) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  } catch {
    // fall through
  }
  return locale;
}

/** Label for selects: "🇳🇱 Nederlands". */
export function localePickerLabel(locale: string): string {
  return `${localeFlagEmoji(locale)} ${localeNativeName(locale)}`;
}

export function allDiscordLocaleCodes(): readonly DiscordLocale[] {
  return DISCORD_LOCALES;
}
