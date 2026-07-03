import type { GuildSettings, PlannedEvent } from "../../generated/prisma/client.js";
import { EventDuty, EventType } from "../../generated/prisma/client.js";
import {
  estDayKey,
  formatEstMonthDay,
  formatEstWeekdayMonthDay,
} from "../../utility/estTime.js";
import { getEventWeekRangeForDate } from "./eventWeek.js";
import { resolveEventType } from "./eventType.js";

export interface ScheduleExportSettings {
  onDutyPingRoleId?: string | null;
  offDutyPingRoleIds?: string[] | null;
  patrolEmojiName?: string | null;
  patrolEmojiId?: string | null;
}

function parseOffDutyPingRoleIds(settings: GuildSettings | null): string[] {
  if (!settings?.eventOffDutyPingRoleIds) {
    return [];
  }
  const raw = settings.eventOffDutyPingRoleIds;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}

export function getScheduleExportSettings(
  settings: GuildSettings | null,
): ScheduleExportSettings {
  return {
    onDutyPingRoleId: settings?.eventOnDutyPingRoleId ?? null,
    offDutyPingRoleIds: parseOffDutyPingRoleIds(settings),
    patrolEmojiName: settings?.eventPatrolEmojiName ?? null,
    patrolEmojiId: settings?.eventPatrolEmojiId ?? null,
  };
}

function groupEventsByEstDay(events: PlannedEvent[]): PlannedEvent[][] {
  const groups = new Map<string, PlannedEvent[]>();
  for (const event of events) {
    const key = estDayKey(event.startTime);
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, list]) => list.sort((a, b) => a.startTime.getTime() - b.startTime.getTime()));
}

function weekRangeLabel(events: PlannedEvent[], ordinal: boolean): string {
  if (events.length === 0) {
    return "";
  }
  const sorted = [...events].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const { start, end } = getEventWeekRangeForDate(sorted[0].startTime);
  const lastDay = new Date(end.getTime() - 1);
  return `${formatEstMonthDay(start, ordinal)} to ${formatEstMonthDay(lastDay, ordinal)}`;
}

function formatPatrolEmoji(settings: ScheduleExportSettings): string | null {
  if (settings.patrolEmojiName && settings.patrolEmojiId) {
    return `<:${settings.patrolEmojiName}:${settings.patrolEmojiId}>`;
  }
  return null;
}

function formatEventTitleLine(
  event: PlannedEvent,
  settings: ScheduleExportSettings,
): string {
  const type = resolveEventType(event);
  const patrolEmoji = formatPatrolEmoji(settings);

  switch (type) {
    case EventType.PATROL:
      return patrolEmoji ? `${patrolEmoji} ${event.title}` : event.title;
    case EventType.GAME:
      return `🎲 ${event.title}`;
    case EventType.SPECIAL:
      if (event.title.includes("🎊")) {
        return event.title;
      }
      return `🎊 ${event.title} 🎊`;
    case EventType.OTHER:
    default:
      return `🎲 ${event.title}`;
  }
}

function formatHostLines(event: PlannedEvent): string[] {
  const lines = [`Host: <@${event.hostId}>`];
  if (event.coHostId) {
    lines.push(`Co-Host: <@${event.coHostId}>`);
  }
  return lines;
}

function formatDaySections(
  events: PlannedEvent[],
  settings: ScheduleExportSettings,
  options: { ordinalDayHeaders: boolean; timestampStyle: "F" | "default" },
): string[] {
  const sections: string[] = [];

  for (const dayEvents of groupEventsByEstDay(events)) {
    const dayHeader = formatEstWeekdayMonthDay(
      dayEvents[0].startTime,
      options.ordinalDayHeaders,
    );
    sections.push(`## ${dayHeader}`);

    for (const event of dayEvents) {
      const unix = Math.floor(event.startTime.getTime() / 1000);
      const timestamp =
        options.timestampStyle === "F"
          ? `<t:${unix}:F>`
          : `<t:${unix}>`;

      sections.push(
        formatEventTitleLine(event, settings),
        timestamp,
        ...formatHostLines(event),
        "",
      );
    }
  }

  return sections;
}

export function formatOnDutyScheduleMessage(
  events: PlannedEvent[],
  settings: ScheduleExportSettings,
): string {
  const onDuty = events
    .filter((e) => e.duty === EventDuty.ON_DUTY)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  if (onDuty.length === 0) {
    return "";
  }

  const ping = settings.onDutyPingRoleId
    ? `<@&${settings.onDutyPingRoleId}>`
    : "";
  const weekLabel = weekRangeLabel(onDuty, true);

  const lines = [
    ping,
    "",
    `Ladies and Gentlemen! Here are your On-Duty Events for the Week of ${weekLabel}`,
    "(Date and Time will be displayed in your Local Time)",
    "",
    ...formatDaySections(onDuty, settings, {
      ordinalDayHeaders: true,
      timestampStyle: "default",
    }),
    "That is all our Events Folks! Have an fantastic Week!",
  ];

  return lines.join("\n").trim();
}

export function formatOffDutyScheduleMessage(
  events: PlannedEvent[],
  settings: ScheduleExportSettings,
): string {
  const offDuty = events
    .filter((e) => e.duty === EventDuty.OFF_DUTY)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  if (offDuty.length === 0) {
    return "";
  }

  const pings = (settings.offDutyPingRoleIds ?? [])
    .map((roleId) => `<@&${roleId}>`)
    .join(" ");
  const weekLabel = weekRangeLabel(offDuty, true);

  const lines = [
    pings,
    "",
    `Heyo everyone! Here is your week of Off Duty Events for ${weekLabel}`,
    "",
    ...formatDaySections(offDuty, settings, {
      ordinalDayHeaders: true,
      timestampStyle: "default",
    }),
  ];

  return lines.join("\n").trim();
}

/** Combined preview for export confirmation. */
export function formatScheduleMessage(
  events: PlannedEvent[],
  settings: ScheduleExportSettings = {},
): string {
  const parts = [
    formatOnDutyScheduleMessage(events, settings),
    formatOffDutyScheduleMessage(events, settings),
  ].filter((part) => part.length > 0);

  if (parts.length === 0) {
    return "No events to export.";
  }

  return parts.join("\n\n---\n\n");
}

export function resolveOnDutyScheduleChannelId(
  settings: GuildSettings | null,
): string | null {
  return settings?.eventOnDutyScheduleChannelId ?? settings?.eventScheduleChannelId ?? null;
}

export function resolveOffDutyScheduleChannelId(
  settings: GuildSettings | null,
): string | null {
  return settings?.eventOffDutyScheduleChannelId ?? null;
}
