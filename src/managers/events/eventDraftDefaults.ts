import { parseEventTime } from "./eventTimeParser.js";

export const DRAFT_PLACEHOLDER_TITLE = "(not set)";
export const DRAFT_PLACEHOLDER_TIME_MS = 0;
const EVENT_TITLE_MAX_LENGTH = 200;

export function isDraftPlaceholderTitle(title: string): boolean {
  return !title.trim() || title === DRAFT_PLACEHOLDER_TITLE;
}

/** Ensure titles end with "Event" (e.g. "Patrol" → "Patrol Event"). */
export function normalizeEventTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed || trimmed === DRAFT_PLACEHOLDER_TITLE) {
    return trimmed;
  }
  if (/\bevent$/i.test(trimmed)) {
    return trimmed.slice(0, EVENT_TITLE_MAX_LENGTH);
  }

  const suffix = " Event";
  const maxBase = EVENT_TITLE_MAX_LENGTH - suffix.length;
  const base = trimmed.slice(0, maxBase).trimEnd();
  return `${base}${suffix}`;
}

export function isDraftPlaceholderTime(startTime: Date): boolean {
  return startTime.getTime() <= DRAFT_PLACEHOLDER_TIME_MS;
}

export function resolveDraftStartTime(
  time: string | null | undefined,
  timezone?: string,
): Date {
  if (!time) {
    return new Date(DRAFT_PLACEHOLDER_TIME_MS);
  }
  return parseEventTime(time, { timezone }) ?? new Date(DRAFT_PLACEHOLDER_TIME_MS);
}
