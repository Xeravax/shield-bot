import * as chrono from "chrono-node";
import {
  EVENT_TIMEZONE,
  formatRelativeFromNow,
  formatTimezoneLabel,
  getESTDateParts,
  getTimezoneDateParts,
  timezoneLocalToUtc,
} from "../../utility/estTime.js";
import {
  getSchedulableEventWeekRange,
  isWithinSchedulableEventWeek,
} from "./eventWeek.js";

const MAX_AUTOCOMPLETE = 25;

const DISCORD_TS_RE = /<t:(\d+)(?::[tTdDfFR])?>/;

export interface EventTimeParseOptions {
  refDate?: Date;
  timezone?: string;
}

function resolveTimezone(timezone?: string): string {
  return timezone ?? EVENT_TIMEZONE;
}

function isAbsoluteTimestampInput(trimmed: string): boolean {
  return /^\d{10,13}$/.test(trimmed) || DISCORD_TS_RE.test(trimmed);
}

interface ParsedWallTime {
  hour: number;
  minute: number;
  second: number;
}

function wallTimeFromChrono(start: chrono.ParsedComponents, timezone: string): ParsedWallTime {
  const parsed = start.date();
  const fallback = getTimezoneDateParts(parsed, timezone);
  return {
    hour: start.get("hour") ?? fallback.hour,
    minute: start.get("minute") ?? fallback.minute,
    second: start.get("second") ?? fallback.second,
  };
}

/**
 * Snap natural-language parses into the schedulable event week (Tue–Sun).
 * chrono's forwardDate picks the nearest future weekday, which is often the
 * current week — but Tue–Sun planning only allows the next event week.
 */
function ensureForwardDate(
  parsed: Date,
  refDate: Date,
  timezone: string,
  wallTime: ParsedWallTime,
): Date {
  const parsedEst = getESTDateParts(parsed);
  if (parsedEst.weekday === 0) {
    return timezoneLocalToUtc(
      timezone,
      parsedEst.year,
      parsedEst.month,
      parsedEst.day,
      wallTime.hour,
      wallTime.minute,
      wallTime.second,
    );
  }

  let { year, month, day } = parsedEst;

  if (!isWithinSchedulableEventWeek(parsed, refDate)) {
    const { start: weekStart } = getSchedulableEventWeekRange(refDate);
    const weekStartEst = getESTDateParts(weekStart);
    year = weekStartEst.year;
    month = weekStartEst.month;
    day = weekStartEst.day + (parsedEst.weekday - 1);
  }

  return timezoneLocalToUtc(
    timezone,
    year,
    month,
    day,
    wallTime.hour,
    wallTime.minute,
    wallTime.second,
  );
}

function parseNaturalLanguageTime(
  trimmed: string,
  refDate: Date,
  timezone: string,
): Date | null {
  const results = chrono.parse(
    trimmed,
    { instant: refDate, timezone },
    { forwardDate: true },
  );
  if (results.length === 0) {
    return null;
  }

  const start = results[0].start;
  return ensureForwardDate(start.date(), refDate, timezone, wallTimeFromChrono(start, timezone));
}

export function parseEventTime(
  input: string,
  options: EventTimeParseOptions = {},
): Date | null {
  const { refDate = new Date(), timezone } = options;
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{10,13}$/.test(trimmed)) {
    const ms = trimmed.length === 13 ? parseInt(trimmed, 10) : parseInt(trimmed, 10) * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const tsMatch = trimmed.match(DISCORD_TS_RE);
  if (tsMatch) {
    return new Date(parseInt(tsMatch[1], 10) * 1000);
  }

  return parseNaturalLanguageTime(trimmed, refDate, resolveTimezone(timezone));
}

export function buildTimeAutocompleteChoices(
  focused: string,
  options: EventTimeParseOptions = {},
): { name: string; value: string }[] {
  const { refDate = new Date(), timezone } = options;
  const tz = resolveTimezone(timezone);
  const trimmed = focused.trim();
  if (!trimmed) {
    return [];
  }

  const unixOnly = /^\d{10,13}$/.test(trimmed);
  if (unixOnly) {
    const ms = trimmed.length === 13 ? parseInt(trimmed, 10) : parseInt(trimmed, 10) * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      const unix = Math.floor(d.getTime() / 1000);
      return [
        {
          name: `${formatTimezoneLabel(d, tz)} — ${formatRelativeFromNow(d, refDate)}`,
          value: String(unix),
        },
      ];
    }
  }

  if (isAbsoluteTimestampInput(trimmed)) {
    return [];
  }

  const results = chrono.parse(
    trimmed,
    { instant: refDate, timezone: tz },
    { forwardDate: true },
  );
  return results.slice(0, MAX_AUTOCOMPLETE).map((r) => {
    const d = ensureForwardDate(r.start.date(), refDate, tz, wallTimeFromChrono(r.start, tz));
    const unix = Math.floor(d.getTime() / 1000);
    return {
      name: `${formatTimezoneLabel(d, tz)} — ${formatRelativeFromNow(d, refDate)}`,
      value: String(unix),
    };
  });
}
