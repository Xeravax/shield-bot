import type { UserPreferences } from "../generated/prisma/client.js";
import { prisma } from "../main.js";
import { EVENT_TIMEZONE } from "./estTime.js";

const MAX_AUTOCOMPLETE = 25;

let cachedTimezones: string[] | null = null;
let cachedSearchMeta: TimezoneSearchMeta[] | null = null;

interface TimezoneSearchMeta {
  id: string;
  idLower: string;
  shortName: string;
  shortNameLower: string;
  longNameLower: string;
  offsetMinutes: number;
  /** Normalized tokens like gmt+10, utc+10:00, +10 for query matching. */
  offsetTokens: Set<string>;
}

export interface ResolvedUserPreferences {
  patrolDmDisabled: boolean;
  patrolNoShieldMemberDmDisabled: boolean;
  eventStatusDmDisabled: boolean;
  /** Effective timezone used for parsing (falls back to EST). */
  timezone: string;
  /** Raw stored value, null when using the default. */
  timezoneStored: string | null;
}

export type UserPreferenceUpdate = Partial<
  Pick<
    UserPreferences,
    | "patrolDmDisabled"
    | "patrolNoShieldMemberDmDisabled"
    | "eventStatusDmDisabled"
    | "timezone"
  >
>;

function allIanaTimezones(): string[] {
  if (!cachedTimezones) {
    cachedTimezones = Intl.supportedValuesOf("timeZone");
  }
  return cachedTimezones;
}

function acceptsTimezoneId(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Format offset minutes as an Intl-accepted fixed offset id, e.g. +10:00. */
function formatFixedOffsetId(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Parse offset-style queries: GMT+10, UTC-5, utc+10:00, +10, +0530, -10:00.
 * Returns offset from UTC in minutes, or null if not an offset query.
 */
export function parseTimezoneOffsetQuery(query: string): number | null {
  const q = query.trim().replace(/\s+/g, "");
  if (!q) {
    return null;
  }

  const match =
    /^(?:(?:gmt|utc))?([+-])(\d{1,2})(?::(\d{2})|(\d{2}))?$/i.exec(q);
  if (!match) {
    return null;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? match[4] ?? "0");
  if (!Number.isFinite(hours) || hours > 14 || minutes >= 60) {
    return null;
  }

  return sign * (hours * 60 + minutes);
}

function offsetSearchTokens(offsetMinutes: number): Set<string> {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const h = String(hours);
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");

  const bare: string[] = [
    `${sign}${h}`,
    `${sign}${hh}`,
    `${sign}${h}:${mm}`,
    `${sign}${hh}:${mm}`,
    `${sign}${h}${mm}`,
    `${sign}${hh}${mm}`,
  ];
  if (minutes === 0) {
    bare.push(`${sign}${h}00`, `${sign}${hh}00`);
  }

  const tokens = new Set<string>();
  for (const form of bare) {
    tokens.add(form.toLowerCase());
    tokens.add(`gmt${form}`.toLowerCase());
    tokens.add(`utc${form}`.toLowerCase());
  }
  if (offsetMinutes === 0) {
    tokens.add("gmt");
    tokens.add("utc");
    tokens.add("+0");
    tokens.add("+00");
    tokens.add("+00:00");
  }
  return tokens;
}

function readTimezoneOffsetMinutes(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const label = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  if (label === "GMT" || label === "UTC") {
    return 0;
  }
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/i.exec(label);
  if (!match) {
    return 0;
  }
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? "0"));
}

function buildTimezoneSearchMeta(date: Date = new Date()): TimezoneSearchMeta[] {
  return allIanaTimezones().map((id) => {
    const shortParts = new Intl.DateTimeFormat("en-US", {
      timeZone: id,
      timeZoneName: "short",
    }).formatToParts(date);
    const longParts = new Intl.DateTimeFormat("en-US", {
      timeZone: id,
      timeZoneName: "long",
    }).formatToParts(date);
    const shortName =
      shortParts.find((p) => p.type === "timeZoneName")?.value ?? "";
    const longName =
      longParts.find((p) => p.type === "timeZoneName")?.value ?? "";
    const offsetMinutes = readTimezoneOffsetMinutes(id, date);

    return {
      id,
      idLower: id.toLowerCase(),
      shortName,
      shortNameLower: shortName.toLowerCase(),
      longNameLower: longName.toLowerCase(),
      offsetMinutes,
      offsetTokens: offsetSearchTokens(offsetMinutes),
    };
  });
}

function timezoneSearchMeta(): TimezoneSearchMeta[] {
  if (!cachedSearchMeta) {
    cachedSearchMeta = buildTimezoneSearchMeta();
  }
  return cachedSearchMeta;
}

/**
 * Resolve user input (IANA, GMT+10, UTC-5, +10:00, EST, …) to a timezone
 * id that Intl accepts. Returns null when nothing valid matches.
 */
export function resolveTimezoneInput(input: string): string | null {
  const raw = input.trim();
  if (!raw) {
    return null;
  }

  const lower = raw.toLowerCase();
  const exactIana = allIanaTimezones().find((tz) => tz.toLowerCase() === lower);
  if (exactIana) {
    return exactIana;
  }

  if (acceptsTimezoneId(raw)) {
    return raw;
  }

  const offsetMinutes = parseTimezoneOffsetQuery(raw);
  if (offsetMinutes !== null) {
    const fixed = formatFixedOffsetId(offsetMinutes);
    if (acceptsTimezoneId(fixed)) {
      return fixed;
    }
  }

  // Common abbreviations Intl accepts directly (EST, PST, GMT, …)
  const upper = raw.toUpperCase();
  if (upper !== raw && acceptsTimezoneId(upper)) {
    return upper;
  }

  return null;
}

export function isValidTimezone(timezone: string): boolean {
  return resolveTimezoneInput(timezone) !== null;
}

/**
 * Autocomplete search: IANA path/name, current offset (GMT+10 / UTC+10 / +10),
 * and short/long abbreviations (EST, Australian Eastern Standard Time, …).
 */
export function searchTimezones(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return allIanaTimezones().slice(0, MAX_AUTOCOMPLETE);
  }

  const q = trimmed.toLowerCase().replace(/\s+/g, "");
  const qSpaced = trimmed.toLowerCase();
  const offsetMinutes = parseTimezoneOffsetQuery(trimmed);
  const scored: { id: string; score: number }[] = [];

  for (const meta of timezoneSearchMeta()) {
    let score = 0;

    if (meta.idLower === qSpaced || meta.idLower === q) {
      score = 100;
    } else if (meta.idLower.includes(qSpaced) || meta.idLower.includes(q)) {
      score = 90;
    } else if (meta.shortNameLower === qSpaced || meta.shortNameLower === q) {
      score = 85;
    } else if (
      meta.shortNameLower.includes(qSpaced) ||
      meta.shortNameLower.includes(q)
    ) {
      score = 75;
    } else if (
      meta.longNameLower.includes(qSpaced) ||
      meta.longNameLower.includes(q)
    ) {
      score = 65;
    } else if (offsetMinutes !== null && meta.offsetMinutes === offsetMinutes) {
      score = 80;
    } else if (meta.offsetTokens.has(q) || meta.offsetTokens.has(qSpaced)) {
      score = 80;
    }

    if (score > 0) {
      scored.push({ id: meta.id, score });
    }
  }

  // Also offer a fixed-offset id when the query itself resolves to one
  // (e.g. GMT+10 → +10:00) and it isn't already an IANA id in the list.
  const resolved = resolveTimezoneInput(trimmed);
  if (resolved && !scored.some((s) => s.id === resolved)) {
    scored.push({ id: resolved, score: 95 });
  }

  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const seen = new Set<string>();
  const results: string[] = [];
  for (const entry of scored) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    results.push(entry.id);
    if (results.length >= MAX_AUTOCOMPLETE) {
      break;
    }
  }
  return results;
}

export function formatTimezoneDisplay(timezone: string): string {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(now);
  const abbr = formatted.find((p) => p.type === "timeZoneName")?.value ?? "";
  return abbr ? `${timezone} (${abbr})` : timezone;
}

function resolvePreferences(
  prefs: UserPreferences | null | undefined,
): ResolvedUserPreferences {
  const stored = prefs?.timezone ?? null;
  const timezone =
    stored && isValidTimezone(stored) ? stored : EVENT_TIMEZONE;

  return {
    patrolDmDisabled: prefs?.patrolDmDisabled ?? false,
    patrolNoShieldMemberDmDisabled:
      prefs?.patrolNoShieldMemberDmDisabled ?? false,
    eventStatusDmDisabled: prefs?.eventStatusDmDisabled ?? false,
    timezone,
    timezoneStored: stored,
  };
}

export async function getResolvedUserPreferences(
  discordId: string,
): Promise<ResolvedUserPreferences> {
  const user = await prisma.user.findUnique({
    where: { discordId },
    include: { userPreferences: true },
  });
  return resolvePreferences(user?.userPreferences);
}

export async function getUserTimezone(discordId: string): Promise<string> {
  const prefs = await getResolvedUserPreferences(discordId);
  return prefs.timezone;
}

/** True when the user has explicitly saved a timezone (not just the EST default). */
export async function hasStoredTimezone(discordId: string): Promise<boolean> {
  const prefs = await getResolvedUserPreferences(discordId);
  return prefs.timezoneStored !== null;
}

async function ensureUser(discordId: string) {
  return prisma.user.upsert({
    where: { discordId },
    create: { discordId },
    update: {},
    include: { userPreferences: true },
  });
}

export async function updateUserPreferences(
  discordId: string,
  data: UserPreferenceUpdate,
): Promise<ResolvedUserPreferences> {
  const normalized: UserPreferenceUpdate = { ...data };
  if (normalized.timezone !== undefined && normalized.timezone !== null) {
    const resolved = resolveTimezoneInput(normalized.timezone);
    if (!resolved) {
      throw new Error(`Invalid timezone: ${normalized.timezone}`);
    }
    normalized.timezone = resolved;
  }

  const user = await ensureUser(discordId);

  await prisma.userPreferences.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      ...normalized,
    },
    update: normalized,
  });

  return getResolvedUserPreferences(discordId);
}

export async function setUserTimezone(
  discordId: string,
  timezone: string,
): Promise<void> {
  await updateUserPreferences(discordId, { timezone });
}

export async function clearUserTimezone(discordId: string): Promise<void> {
  await updateUserPreferences(discordId, { timezone: null });
}

export function patrolDmEnabled(prefs: ResolvedUserPreferences): boolean {
  return !prefs.patrolDmDisabled;
}

export function noShieldMemberDmEnabled(prefs: ResolvedUserPreferences): boolean {
  return !prefs.patrolNoShieldMemberDmDisabled;
}

export function eventStatusDmEnabled(prefs: ResolvedUserPreferences): boolean {
  return !prefs.eventStatusDmDisabled;
}
