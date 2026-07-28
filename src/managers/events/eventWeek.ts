import {
  estLocalToUtc,
  formatEstWeekdayMonthDay,
  getESTDateParts,
} from "../../utility/estTime.js";

/** Tuesday 00:00 EST through Monday 00:00 EST (exclusive) containing the given date. */
export function getEventWeekRangeForDate(date: Date): { start: Date; end: Date } {
  const parts = getESTDateParts(date);

  if (parts.weekday === 0) {
    const start = estLocalToUtc(parts.year, parts.month, parts.day - 6, 0, 0, 0);
    return {
      start,
      end: estLocalToUtc(parts.year, parts.month, parts.day + 1, 0, 0, 0),
    };
  }

  const tuesdayDay = parts.day - (parts.weekday - 1);
  const start = estLocalToUtc(parts.year, parts.month, tuesdayDay, 0, 0, 0);
  return {
    start,
    end: estLocalToUtc(parts.year, parts.month, tuesdayDay + 7, 0, 0, 0),
  };
}

/**
 * The event week hosts may currently schedule into.
 * Monday = planning day for the upcoming Tue–Mon week.
 * Tuesday–Sunday = only the next Tue–Mon week.
 */
export function getSchedulableEventWeekRange(now = new Date()): { start: Date; end: Date } {
  const parts = getESTDateParts(now);
  let daysUntilTuesday: number;

  if (parts.weekday === 0) {
    daysUntilTuesday = 1;
  } else if (parts.weekday === 1) {
    daysUntilTuesday = 7;
  } else {
    daysUntilTuesday = 8 - parts.weekday;
  }

  const tuesdayDay = parts.day + daysUntilTuesday;
  const start = estLocalToUtc(parts.year, parts.month, tuesdayDay, 0, 0, 0);
  return {
    start,
    end: estLocalToUtc(parts.year, parts.month, tuesdayDay + 7, 0, 0, 0),
  };
}

export type ExportWeekChoice = "auto" | "current" | "previous" | "next";

export function getCurrentEventWeekRange(now = new Date()): { start: Date; end: Date } {
  return getEventWeekRangeForDate(now);
}

export function getPreviousEventWeekRange(now = new Date()): { start: Date; end: Date } {
  const current = getCurrentEventWeekRange(now);
  return getEventWeekRangeForDate(new Date(current.start.getTime() - 1));
}

export function getNextEventWeekRange(now = new Date()): { start: Date; end: Date } {
  const current = getCurrentEventWeekRange(now);
  return getEventWeekRangeForDate(current.end);
}

export function getExportWeekRangeByChoice(
  choice: Exclude<ExportWeekChoice, "auto">,
  now = new Date(),
): { start: Date; end: Date } {
  switch (choice) {
    case "previous":
      return getPreviousEventWeekRange(now);
    case "next":
      return getNextEventWeekRange(now);
    case "current":
    default:
      return getCurrentEventWeekRange(now);
  }
}

export function formatEventWeekRangeLabel(range: {
  start: Date;
  end: Date;
}): string {
  const lastDay = new Date(range.end.getTime() - 1);
  return `${formatEstWeekdayMonthDay(range.start)} through ${formatEstWeekdayMonthDay(lastDay)}`;
}

export function isWithinSchedulableEventWeek(
  startTime: Date,
  now = new Date(),
): boolean {
  const { start, end } = getSchedulableEventWeekRange(now);
  return startTime.getTime() >= start.getTime() && startTime.getTime() < end.getTime();
}

export function formatSchedulableWeekRangeLabel(now = new Date()): string {
  const { start, end } = getSchedulableEventWeekRange(now);
  const lastDay = new Date(end.getTime() - 1);
  return `${formatEstWeekdayMonthDay(start)} through ${formatEstWeekdayMonthDay(lastDay)}`;
}

export function buildPlanningMessageUrl(
  guildId: string,
  channelId: string,
  messageId: string,
): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}
