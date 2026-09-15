/** Discord API locale codes — only valid filenames under locales/. */
export const DISCORD_LOCALES = [
  "id",
  "da",
  "de",
  "en-GB",
  "en-US",
  "es-ES",
  "es-419",
  "fr",
  "hr",
  "it",
  "lt",
  "hu",
  "nl",
  "no",
  "pl",
  "pt-BR",
  "ro",
  "fi",
  "sv-SE",
  "vi",
  "tr",
  "cs",
  "el",
  "bg",
  "ru",
  "uk",
  "hi",
  "th",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko",
] as const;

export type DiscordLocale = (typeof DISCORD_LOCALES)[number];

export const DEFAULT_LOCALE: DiscordLocale = "en-US";

export const DISCORD_LOCALE_SET = new Set<string>(DISCORD_LOCALES);

export function isDiscordLocale(value: string): value is DiscordLocale {
  return DISCORD_LOCALE_SET.has(value);
}

/** Default ISO 3166 region for language-only Discord locales (flag derivation). */
export const LANGUAGE_DEFAULT_REGION: Record<string, string> = {
  id: "ID",
  da: "DK",
  de: "DE",
  fr: "FR",
  hr: "HR",
  it: "IT",
  lt: "LT",
  hu: "HU",
  nl: "NL",
  no: "NO",
  pl: "PL",
  ro: "RO",
  fi: "FI",
  vi: "VN",
  tr: "TR",
  cs: "CZ",
  el: "GR",
  bg: "BG",
  ru: "RU",
  uk: "UA",
  hi: "IN",
  th: "TH",
  ja: "JP",
  ko: "KR",
};

/** Special locales that are not country-based. */
export const LOCALE_FLAG_OVERRIDE: Record<string, string> = {
  "es-419": "🌎",
};
