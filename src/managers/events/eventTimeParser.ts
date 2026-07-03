import * as chrono from "chrono-node";
import {
  EVENT_TIMEZONE,
  formatRelativeFromNow,
  formatTimezoneLabel,
} from "../../utility/estTime.js";

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

function ensureForwardDate(parsed: Date, _refDate: Date): Date {
  return parsed;
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

  return ensureForwardDate(results[0].start.date(), refDate);
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
    const d = ensureForwardDate(r.start.date(), refDate);
    const unix = Math.floor(d.getTime() / 1000);
    return {
      name: `${formatTimezoneLabel(d, tz)} — ${formatRelativeFromNow(d, refDate)}`,
      value: String(unix),
    };
  });
}
