import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import i18next, { type TOptions } from "i18next";
import {
  DEFAULT_LOCALE,
  DISCORD_LOCALE_SET,
  isDiscordLocale,
  type DiscordLocale,
} from "./discordLocales.js";
import { localePickerLabel } from "./localeDisplay.js";

export {
  DEFAULT_LOCALE,
  DISCORD_LOCALES,
  DISCORD_LOCALE_SET,
  isDiscordLocale,
  type DiscordLocale,
} from "./discordLocales.js";
export {
  localeFlagEmoji,
  localeNativeName,
  localePickerLabel,
  regionToFlagEmoji,
} from "./localeDisplay.js";

type JsonObject = Record<string, unknown>;

let initialized = false;
let availableLocales: DiscordLocale[] = [DEFAULT_LOCALE];

function resolveLocalesDir(): string {
  const candidates = [
    path.join(process.cwd(), "locales"),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "locales"),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "locales"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, `${DEFAULT_LOCALE}.json`))) {
      return dir;
    }
  }
  return candidates[0];
}

function flattenKeys(obj: JsonObject, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const pathKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const nested = v as JsonObject;
      // Plural forms: one/other/etc. treated as leaf
      const pluralKeys = ["zero", "one", "two", "few", "many", "other"];
      const isPlural =
        Object.keys(nested).length > 0 &&
        Object.keys(nested).every((pk) => pluralKeys.includes(pk));
      if (isPlural) {
        keys.push(pathKey);
      } else {
        keys.push(...flattenKeys(nested, pathKey));
      }
    } else {
      keys.push(pathKey);
    }
  }
  return keys;
}

function loadLocaleFile(dir: string, locale: string): JsonObject | null {
  const filePath = path.join(dir, `${locale}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as JsonObject;
  } catch (err) {
    console.error(`[i18n] Failed to parse ${filePath}`, err);
    return null;
  }
}

/**
 * Discover locale files, validate against Discord locale list, load into i18next.
 * Call once at bot startup before handling interactions.
 */
export async function initI18n(): Promise<void> {
  if (initialized) {
    return;
  }

  const dir = resolveLocalesDir();
  const resources: Record<string, { translation: JsonObject }> = {};
  const found: DiscordLocale[] = [];

  if (!fs.existsSync(dir)) {
    console.warn(`[i18n] Locales directory not found: ${dir}`);
  } else {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      const code = entry.slice(0, -".json".length);
      if (!DISCORD_LOCALE_SET.has(code)) {
        console.warn(
          `[i18n] Ignoring unknown locale file (not a Discord locale): ${entry}`,
        );
        continue;
      }
      const data = loadLocaleFile(dir, code);
      if (!data) {
        continue;
      }
      resources[code] = { translation: data };
      found.push(code as DiscordLocale);
    }
  }

  const en = loadLocaleFile(dir, DEFAULT_LOCALE);
  if (!en) {
    console.error(
      `[i18n] Required fallback ${DEFAULT_LOCALE}.json missing under ${dir}`,
    );
    resources[DEFAULT_LOCALE] = { translation: {} };
  } else if (!found.includes(DEFAULT_LOCALE)) {
    resources[DEFAULT_LOCALE] = { translation: en };
    found.push(DEFAULT_LOCALE);
  }

  // Warn on keys in other locales that are not in en-US
  const enKeys = new Set(flattenKeys(resources[DEFAULT_LOCALE]?.translation ?? {}));
  for (const locale of found) {
    if (locale === DEFAULT_LOCALE) {
      continue;
    }
    for (const key of flattenKeys(resources[locale]?.translation ?? {})) {
      if (!enKeys.has(key)) {
        console.warn(
          `[i18n] Key "${key}" in ${locale}.json is missing from ${DEFAULT_LOCALE}.json`,
        );
      }
    }
  }

  availableLocales = found.sort((a, b) => {
    if (a === DEFAULT_LOCALE) return -1;
    if (b === DEFAULT_LOCALE) return 1;
    return a.localeCompare(b);
  });

  await i18next.init({
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    resources,
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  });

  initialized = true;
}

/** Locales that have a JSON file on disk. */
export function getAvailableLocales(): readonly DiscordLocale[] {
  return availableLocales;
}

export function isAvailableLocale(value: string): value is DiscordLocale {
  return availableLocales.includes(value as DiscordLocale);
}

export type LocaleOption = {
  code: DiscordLocale;
  label: string;
};

/** Options for Discord selects / slash choices. */
export function getLocalePickerOptions(): LocaleOption[] {
  return getAvailableLocales().map((code) => ({
    code,
    label: localePickerLabel(code),
  }));
}

/**
 * Translate a key for the given locale.
 * Falls back to en-US when the key or locale is missing.
 */
export function t(
  locale: string | null | undefined,
  key: string,
  vars?: TOptions | Record<string, unknown>,
): string {
  const lng =
    locale && isDiscordLocale(locale) ? locale : DEFAULT_LOCALE;
  const result = i18next.t(key, {
    lng,
    ...(vars as TOptions),
  });
  return typeof result === "string" ? result : String(result);
}

/**
 * Build Discord LocalizationMap for slash descriptions from a key
 * across all loaded locales (excluding en-US which is the default description).
 */
export function descriptionLocalizationsForKey(
  key: string,
): Partial<Record<DiscordLocale, string>> {
  const map: Partial<Record<DiscordLocale, string>> = {};
  for (const locale of getAvailableLocales()) {
    if (locale === DEFAULT_LOCALE) {
      continue;
    }
    const value = t(locale, key);
    if (value && value !== key) {
      map[locale] = value;
    }
  }
  return map;
}

/** Format a date with Intl using the resolved locale. */
export function formatDate(
  locale: string | null | undefined,
  date: Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const lng =
    locale && isDiscordLocale(locale) ? locale : DEFAULT_LOCALE;
  return date.toLocaleDateString(lng, options);
}

/** Format date+time with Intl using the resolved locale. */
export function formatDateTime(
  locale: string | null | undefined,
  date: Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const lng =
    locale && isDiscordLocale(locale) ? locale : DEFAULT_LOCALE;
  return date.toLocaleString(lng, options);
}

/** Month name (1–12) in the given locale. */
export function formatMonthName(
  locale: string | null | undefined,
  month: number,
  year?: number,
): string {
  const lng =
    locale && isDiscordLocale(locale) ? locale : DEFAULT_LOCALE;
  const d = new Date(Date.UTC(year ?? 2000, month - 1, 1));
  return new Intl.DateTimeFormat(lng, { month: "long", timeZone: "UTC" }).format(
    d,
  );
}
