import * as chrono from "chrono-node";
import {
  EVENT_TIMEZONE,
  formatRelativeFromNow,
  formatTimezoneLabel,
  getESTDateParts,
  getTimezoneDateParts,
  timezoneLocalToUtc,
} from "../../utility/estTime.js";
import { getSchedulableEventWeekRange } from "./eventWeek.js";

const MAX_AUTOCOMPLETE = 25;

const DISCORD_TS_RE = /<t:(\d+)(?::[tTdDfFR])?>/;

export interface EventTimeParseOptions {
  refDate?: Date;
  timezone?: string;
  /**
   * Week to snap weekday-only / out-of-window parses into.
   * Defaults to the schedulable planning week (next week Tue–Sun).
   * Pass the current event week when editing an already-exported event.
   * Ignored when `enforceWeek` is false (force).
   */
  snapIntoWeek?: { start: Date; end: Date };
  /**
   * When false (force), keep chrono's date instead of snapping into a planning week.
   * Defaults to true.
   */
  enforceWeek?: boolean;
  /**
   * When false, do not push past parses into the future (approved-event edits).
   * Defaults to true.
   */
  forwardDate?: boolean;
}

function resolveTimezone(timezone?: string): string {
  return timezone ?? EVENT_TIMEZONE;
}

function isAbsoluteTimestampInput(trimmed: string): boolean {
  return /^\d{10,13}$/.test(trimmed) || DISCORD_TS_RE.test(trimmed);
}

interface ParsedCivilTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** Monday = 0 … Sunday = 6 */
  weekday: number;
}

/**
 * Chrono uses JS weekday (0 = Sunday). Scheduling uses Monday = 0.
 * `get("weekday")` is 0 for Sunday, so do not use truthiness checks.
 */
function chronoWeekdayToMondayBased(weekday: number): number {
  return (weekday + 6) % 7;
}

/**
 * Read the intended wall clock from chrono components in the host timezone.
 * `start.date()` is in the process timezone and is wrong at midnight when the
 * host TZ is east of the server (Sunday 12AM becomes Saturday).
 */
function civilTimeFromChrono(
  start: chrono.ParsedComponents,
  timezone: string,
): ParsedCivilTime {
  const parsed = start.date();
  const fallback = getTimezoneDateParts(parsed, timezone);
  const chronoWeekday = start.get("weekday");
  return {
    year: start.get("year") ?? fallback.year,
    month: start.get("month") ?? fallback.month,
    day: start.get("day") ?? fallback.day,
    hour: start.get("hour") ?? fallback.hour,
    minute: start.get("minute") ?? fallback.minute,
    second: start.get("second") ?? fallback.second,
    weekday:
      typeof chronoWeekday === "number"
        ? chronoWeekdayToMondayBased(chronoWeekday)
        : fallback.weekday,
  };
}

function isWithinWeek(
  date: Date,
  week: { start: Date; end: Date },
): boolean {
  const t = date.getTime();
  return t >= week.start.getTime() && t < week.end.getTime();
}

/**
 * Snap natural-language parses into the target event week (Tue–Sun).
 * chrono's forwardDate picks the nearest future weekday, which is often the
 * current week - but new planning on Tue–Sun only allows the next event week.
 * Exported current-week edits pass that week so the time is not jumped forward.
 * Force (`enforceWeek: false`) keeps the parsed date as-is.
 */
function ensureForwardDate(
  start: chrono.ParsedComponents,
  refDate: Date,
  timezone: string,
  snapIntoWeek?: { start: Date; end: Date },
  enforceWeek = true,
): Date {
  const civil = civilTimeFromChrono(start, timezone);
  let { year, month, day } = civil;

  const asLocal = (): Date =>
    timezoneLocalToUtc(
      timezone,
      year,
      month,
      day,
      civil.hour,
      civil.minute,
      civil.second,
    );

  if (enforceWeek && civil.weekday !== 0) {
    const week = snapIntoWeek ?? getSchedulableEventWeekRange(refDate);
    if (!isWithinWeek(asLocal(), week)) {
      const weekStartEst = getESTDateParts(week.start);
      year = weekStartEst.year;
      month = weekStartEst.month;
      day = weekStartEst.day + (civil.weekday - 1);
    }
  }

  return asLocal();
}

function parseNaturalLanguageTime(
  trimmed: string,
  refDate: Date,
  timezone: string,
  snapIntoWeek?: { start: Date; end: Date },
  enforceWeek = true,
  forwardDate = true,
): Date | null {
  const results = chrono.parse(
    trimmed,
    { instant: refDate, timezone },
    { forwardDate },
  );
  if (results.length === 0) {
    return null;
  }

  return ensureForwardDate(
    results[0].start,
    refDate,
    timezone,
    snapIntoWeek,
    enforceWeek,
  );
}

export function parseEventTime(
  input: string,
  options: EventTimeParseOptions = {},
): Date | null {
  const {
    refDate = new Date(),
    timezone,
    snapIntoWeek,
    enforceWeek = true,
    forwardDate = true,
  } = options;
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

  return parseNaturalLanguageTime(
    trimmed,
    refDate,
    resolveTimezone(timezone),
    snapIntoWeek,
    enforceWeek,
    forwardDate,
  );
}

export function buildTimeAutocompleteChoices(
  focused: string,
  options: EventTimeParseOptions = {},
): { name: string; value: string }[] {
  const { refDate = new Date(), timezone, snapIntoWeek, enforceWeek = true } = options;
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
          name: `${formatTimezoneLabel(d, tz)} - ${formatRelativeFromNow(d, refDate)}`,
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
    const d = ensureForwardDate(
      r.start,
      refDate,
      tz,
      snapIntoWeek,
      enforceWeek,
    );
    const unix = Math.floor(d.getTime() / 1000);
    return {
      name: `${formatTimezoneLabel(d, tz)} - ${formatRelativeFromNow(d, refDate)}`,
      value: String(unix),
    };
  });
}
