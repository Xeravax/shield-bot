import { parseEventTime } from "./eventTimeParser.js";

export const DRAFT_PLACEHOLDER_TITLE = "(not set)";
export const DRAFT_PLACEHOLDER_TIME_MS = 0;

export function isDraftPlaceholderTitle(title: string): boolean {
  return !title.trim() || title === DRAFT_PLACEHOLDER_TITLE;
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
