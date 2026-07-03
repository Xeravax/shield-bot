import { EventDuty, EventType, type PlannedEvent } from "../../generated/prisma/client.js";

export const EVENT_DURATION_OPTIONS = [60, 120, 180] as const;
export type EventDurationMinutes = (typeof EVENT_DURATION_OPTIONS)[number];

const ON_DUTY_DURATION_OPTIONS = [120, 180] as const;
const OFF_DUTY_DURATION_OPTIONS = [60, 120] as const;

export function allowedDurationOptions(duty: EventDuty): readonly number[] {
  return duty === EventDuty.OFF_DUTY
    ? OFF_DUTY_DURATION_OPTIONS
    : ON_DUTY_DURATION_OPTIONS;
}

export function isDurationAllowedForDuty(
  minutes: number,
  duty: EventDuty,
): boolean {
  return allowedDurationOptions(duty).includes(minutes);
}

export function defaultDurationMinutes(duty: EventDuty): number {
  return duty === EventDuty.OFF_DUTY ? 60 : 120;
}

export function formatDurationLabel(minutes: number): string {
  const hours = minutes / 60;
  return `${hours}h`;
}

export function nextDurationMinutes(current: number, duty: EventDuty): number {
  const options = allowedDurationOptions(duty);
  const idx = options.indexOf(current);
  if (idx === -1) {
    return defaultDurationMinutes(duty);
  }
  return options[(idx + 1) % options.length];
}

const TYPE_CYCLE: (EventType | null)[] = [
  null,
  EventType.PATROL,
  EventType.GAME,
  EventType.SPECIAL,
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
