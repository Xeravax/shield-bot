import { EventDuty, EventType, type PlannedEvent } from "../../generated/prisma/client.js";

export const EVENT_DURATION_OPTIONS = [60, 120, 180] as const;
export type EventDurationMinutes = (typeof EVENT_DURATION_OPTIONS)[number];

const ON_DUTY_DURATION_OPTIONS = [120, 180] as const;
/** Discord-style floor; off-duty has no hour-collection cap beyond this. */
export const MIN_EVENT_DURATION_MINUTES = 15;
/** Off-duty events must still fit in the event week (Tue–Mon). */
export const MAX_OFF_DUTY_DURATION_MINUTES = 7 * 24 * 60;

export function allowedDurationOptions(duty: EventDuty): readonly number[] {
  return duty === EventDuty.OFF_DUTY
    ? EVENT_DURATION_OPTIONS
    : ON_DUTY_DURATION_OPTIONS;
}

export function isDurationAllowedForDuty(
  minutes: number,
  duty: EventDuty,
): boolean {
  if (!Number.isInteger(minutes)) {
    return false;
  }
  if (duty === EventDuty.ON_DUTY) {
    return ON_DUTY_DURATION_OPTIONS.includes(
      minutes as (typeof ON_DUTY_DURATION_OPTIONS)[number],
    );
  }
  return (
    minutes >= MIN_EVENT_DURATION_MINUTES &&
    minutes <= MAX_OFF_DUTY_DURATION_MINUTES
  );
}

export function defaultDurationMinutes(duty: EventDuty): number {
  return duty === EventDuty.OFF_DUTY ? 60 : 120;
}

export function formatDurationLabel(minutes: number): string {
  if (minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function nextDurationMinutes(current: number, duty: EventDuty): number {
  const options = allowedDurationOptions(duty);
  const idx = options.indexOf(current);
  if (idx === -1) {
    return defaultDurationMinutes(duty);
  }
  return options[(idx + 1) % options.length];
}

/** Parse a duration typed as hours (`2`, `2h`, `1.5`) or minutes (`90m`). */
export function parseDurationHoursInput(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const minuteMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes)$/);
  if (minuteMatch) {
    const minutes = Math.round(Number(minuteMatch[1]));
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  }

  const hourMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)?$/);
  if (!hourMatch) {
    return null;
  }
  const hours = Number(hourMatch[1]);
  if (!Number.isFinite(hours) || hours <= 0) {
    return null;
  }
  const minutes = Math.round(hours * 60);
  return minutes > 0 ? minutes : null;
}

const TYPE_CYCLE: (EventType | null)[] = [
  null,
  EventType.PATROL,
  EventType.GAME,
  EventType.SPECIAL,
  EventType.RECRUITMENT,
  EventType.OTHER,
];

export function nextEventType(current: EventType | null): EventType | null {
  const idx = TYPE_CYCLE.indexOf(current);
  const nextIdx = idx === -1 ? 0 : (idx + 1) % TYPE_CYCLE.length;
  return TYPE_CYCLE[nextIdx];
}

export function eventTypeLabel(type: EventType): string {
  switch (type) {
    case EventType.PATROL:
      return "Patrol";
    case EventType.GAME:
      return "Game";
    case EventType.SPECIAL:
      return "Special";
    case EventType.RECRUITMENT:
      return "Recruitment";
    case EventType.OTHER:
      return "Other";
  }
}

/** Infer type from title keywords. Returns null when unknown. */
export function inferEventTypeFromTitle(
  title: string,
  duty: EventDuty,
): EventType | null {
  const t = title.trim().toLowerCase();
  if (!t || t === "(not set)") {
    return null;
  }

  if (
    /special\s+points|points\s+event|roulette|single\s+squad|🎊/.test(t)
  ) {
    return EventType.SPECIAL;
  }
  if (/\brecruit(?:ment|ing)?\b/.test(t)) {
    return EventType.RECRUITMENT;
  }
  if (/\bpatrol\b/.test(t)) {
    return EventType.PATROL;
  }
  if (/\bgame\b/.test(t)) {
    return EventType.GAME;
  }
  if (/\boff[- ]?duty\b/.test(t) || duty === EventDuty.OFF_DUTY) {
    return EventType.OTHER;
  }

  return null;
}

/** Effective type: explicit override first, then title inference, else OTHER. */
export function resolveEventType(event: Pick<PlannedEvent, "title" | "duty" | "eventType">): EventType {
  if (event.eventType) {
    return event.eventType;
  }
  return inferEventTypeFromTitle(event.title, event.duty) ?? EventType.OTHER;
}

export function formatEventTypeDisplay(
  event: Pick<PlannedEvent, "title" | "duty" | "eventType">,
): string {
  const resolved = resolveEventType(event);
  const inferred = inferEventTypeFromTitle(event.title, event.duty);
  if (event.eventType) {
    if (inferred && inferred !== event.eventType) {
      return `${eventTypeLabel(resolved)} (override)`;
    }
    return eventTypeLabel(resolved);
  }
  if (inferred) {
    return `${eventTypeLabel(resolved)} (from title)`;
  }
  return `${eventTypeLabel(resolved)} (auto)`;
}

export function parseEventTypeOption(value: string | null): EventType | null {
  if (!value || value === "auto") {
    return null;
  }
  switch (value.toLowerCase()) {
    case "patrol":
      return EventType.PATROL;
    case "game":
      return EventType.GAME;
    case "special":
      return EventType.SPECIAL;
    case "recruitment":
      return EventType.RECRUITMENT;
    case "other":
      return EventType.OTHER;
    default:
      return null;
  }
}

export function parseDurationOption(value: number | null, duty: EventDuty): number {
  if (value && isDurationAllowedForDuty(value, duty)) {
    return value;
  }
  return defaultDurationMinutes(duty);
}
