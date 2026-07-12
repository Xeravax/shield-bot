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
 * The event week hosts may currently schedule or export.
 * Monday = planning day for the current Tue–Sun week.
 * Tuesday–Sunday = only the next Tue–Sun week.
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
