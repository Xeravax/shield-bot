/** America/New_York — all event scheduling rules use this timezone. */
export const EVENT_TIMEZONE = "America/New_York";

const WEEKDAY_MAP: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

export interface ESTDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Monday … 6 = Sunday
}

function getTimezoneOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      map[p.type] = p.value;
    }
  }
  const asUtc = Date.UTC(
    +map.year,
    +map.month - 1,
    +map.day,
    +map.hour,
    +map.minute,
    +map.second,
  );
  return asUtc - date.getTime();
}

/** Convert a local date/time in EVENT_TIMEZONE to a UTC Date. */
export function estLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimezoneOffsetMs(EVENT_TIMEZONE, guess);
  return new Date(guess.getTime() - offset);
}

export function getESTDateParts(date: Date): ESTDateParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: EVENT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      map[p.type] = p.value;
    }
  }
  const weekdayShort = map.weekday ?? "Mon";
  return {
    year: +map.year,
    month: +map.month,
    day: +map.day,
    hour: +map.hour,
    minute: +map.minute,
    second: +map.second,
    weekday: WEEKDAY_MAP[weekdayShort] ?? 0,
  };
}

export function isMondayEST(date: Date): boolean {
  return getESTDateParts(date).weekday === 0;
}

/** Monday 00:00:00 EST through next Monday 00:00:00 EST (exclusive end). */
export function getESTWeekRange(date: Date): { start: Date; end: Date } {
  const parts = getESTDateParts(date);
  const mondayDay = parts.day - parts.weekday;
  const start = estLocalToUtc(parts.year, parts.month, mondayDay, 0, 0, 0);
  const end = estLocalToUtc(parts.year, parts.month, mondayDay + 7, 0, 0, 0);
  return { start, end };
}

export function formatESTLabel(date: Date): string {
  return formatTimezoneLabel(date, EVENT_TIMEZONE);
}

export function formatTimezoneLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatRelativeFromNow(target: Date, now = new Date()): string {
  const diffMs = target.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);
  const future = diffMs > 0;
  const minutes = Math.round(absMs / 60_000);
  if (minutes < 60) {
    return future ? `in ${minutes} min` : `${minutes} min ago`;
  }
  const hours = Math.round(absMs / 3_600_000);
  if (hours < 48) {
    return future ? `in ${hours} hours` : `${hours} hours ago`;
  }
  const days = Math.round(absMs / 86_400_000);
  return future ? `in ${days} days` : `${days} days ago`;
}

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function formatOrdinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return `${day}th`;
  }
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

export function formatEstWeekdayMonthDay(date: Date, ordinal = false): string {
  const parts = getESTDateParts(date);
  const month = MONTH_NAMES[parts.month - 1];
  const day = ordinal ? formatOrdinal(parts.day) : String(parts.day);
  return `${WEEKDAY_NAMES[parts.weekday]} ${month} ${day}`;
}

export function formatEstMonthDay(date: Date, ordinal = false): string {
  const parts = getESTDateParts(date);
  const month = MONTH_NAMES[parts.month - 1];
  const day = ordinal ? formatOrdinal(parts.day) : String(parts.day);
  return `${month} ${day}`;
}

export function estDayKey(date: Date): string {
  const parts = getESTDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}
