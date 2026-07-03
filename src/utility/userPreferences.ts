import type { UserPreferences } from "../generated/prisma/client.js";
import { prisma } from "../main.js";
import { EVENT_TIMEZONE } from "./estTime.js";

const MAX_AUTOCOMPLETE = 25;

let cachedTimezones: string[] | null = null;

export interface ResolvedUserPreferences {
  patrolDmDisabled: boolean;
  patrolNoShieldMemberDmDisabled: boolean;
  /** Effective timezone used for parsing (falls back to EST). */
  timezone: string;
  /** Raw stored value, null when using the default. */
  timezoneStored: string | null;
}

export type UserPreferenceUpdate = Partial<
  Pick<UserPreferences, "patrolDmDisabled" | "patrolNoShieldMemberDmDisabled" | "timezone">
>;

function allIanaTimezones(): string[] {
  if (!cachedTimezones) {
    cachedTimezones = Intl.supportedValuesOf("timeZone");
  }
  return cachedTimezones;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function searchTimezones(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return allIanaTimezones().slice(0, MAX_AUTOCOMPLETE);
  }
  return allIanaTimezones()
    .filter((tz) => tz.toLowerCase().includes(q))
    .slice(0, MAX_AUTOCOMPLETE);
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

async function ensureUser(discordId: string) {
  let user = await prisma.user.findUnique({
    where: { discordId },
    include: { userPreferences: true },
  });

  if (!user) {
    user = await prisma.user.create({
      data: { discordId },
      include: { userPreferences: true },
    });
  }

  return user;
}

export async function updateUserPreferences(
  discordId: string,
  data: UserPreferenceUpdate,
): Promise<ResolvedUserPreferences> {
  if (data.timezone !== undefined && data.timezone !== null && !isValidTimezone(data.timezone)) {
    throw new Error(`Invalid timezone: ${data.timezone}`);
  }

  const user = await ensureUser(discordId);

  if (user.userPreferences) {
    await prisma.userPreferences.update({
      where: { userId: user.id },
      data,
    });
  } else {
    await prisma.userPreferences.create({
      data: {
        userId: user.id,
        ...data,
      },
    });
  }

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
