import crypto from "crypto";
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventStatus,
  type Guild,
  type GuildScheduledEvent,
} from "discord.js";
import {
  EventDuty,
  PlannedEventStatus,
  type PlannedEvent,
} from "../../generated/prisma/client.js";
import { getEnv } from "../../config/env.js";
import { bot, prisma } from "../../main.js";
import {
  buildVcalendar,
  stripDiscordMarkup,
  type IcalEventInput,
} from "../../utility/ical.js";
import { isDraftPlaceholderTime } from "./eventDraftDefaults.js";
import { buildDiscordScheduledEventName } from "./eventCalendarNaming.js";
import { resolveEventMemberDisplayName } from "./eventUserDisplay.js";

const FALLBACK_LOCATION = "VRChat";

const FEEDABLE_STATUSES = new Set([
  GuildScheduledEventStatus.Scheduled,
  GuildScheduledEventStatus.Active,
]);

/** How far back personal host feeds include ended events. */
const HOST_FEED_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

function discordEventLocation(event: GuildScheduledEvent): string | undefined {
  if (event.entityType === GuildScheduledEventEntityType.External) {
    return event.entityMetadata?.location ?? undefined;
  }
  if (event.channelId) {
    const channel = event.channel ?? event.guild?.channels.cache.get(event.channelId);
    if (channel && "name" in channel && typeof channel.name === "string") {
      return channel.name;
    }
  }
  return undefined;
}

async function buildPlannedEventCalendarFields(
  guild: Guild,
  event: Pick<PlannedEvent, "title" | "hostId" | "coHostId" | "duty">,
): Promise<{ summary: string; description: string }> {
  const hostName = await resolveEventMemberDisplayName(guild, event.hostId);
  const lines = [`Host: ${hostName}`];
  if (event.coHostId) {
    lines.push(
      `Co-host: ${await resolveEventMemberDisplayName(guild, event.coHostId)}`,
    );
  }
  lines.push(
    `Duty: ${event.duty === EventDuty.ON_DUTY ? "On-duty" : "Off-duty"}`,
  );
  return {
    summary: buildDiscordScheduledEventName(hostName, event.title),
    description: lines.join("\n"),
  };
}

function mapDiscordEventToIcal(
  event: GuildScheduledEvent,
  guildId: string,
  override?: { summary: string; description: string },
): IcalEventInput | null {
  if (!event.scheduledStartTimestamp) {
    return null;
  }

  const start = new Date(event.scheduledStartTimestamp);
  const end = event.scheduledEndTimestamp
    ? new Date(event.scheduledEndTimestamp)
    : undefined;

  const description = override?.description
    ?? (event.description ? stripDiscordMarkup(event.description) : undefined);

  return {
    uid: `discord-event-${event.id}@vrcshield.com`,
    summary: override?.summary ?? event.name,
    description: description || undefined,
    location: discordEventLocation(event),
    url: `https://discord.com/events/${guildId}/${event.id}`,
    start,
    end,
  };
}

function hashIcs(ics: string): string {
  return crypto.createHash("sha256").update(ics).digest("hex");
}

export async function buildGuildDiscordEventCalendar(guildId: string): Promise<{
  ics: string;
  etag: string;
} | null> {
  const guild = bot.guilds.cache.get(guildId);
  if (!guild) {
    return null;
  }

  const [events, planned] = await Promise.all([
    guild.scheduledEvents.fetch(),
    prisma.plannedEvent.findMany({
      where: { guildId, discordEventId: { not: null } },
      select: {
        discordEventId: true,
        title: true,
        hostId: true,
        coHostId: true,
        duty: true,
      },
    }),
  ]);

  const plannedByDiscordId = new Map(
    planned
      .filter((p): p is typeof p & { discordEventId: string } =>
        p.discordEventId != null,
      )
      .map((p) => [p.discordEventId, p]),
  );

  const icalEvents: IcalEventInput[] = [];

  for (const event of events.values()) {
    if (!FEEDABLE_STATUSES.has(event.status)) {
      continue;
    }
    const linked = plannedByDiscordId.get(event.id);
    const override = linked
      ? await buildPlannedEventCalendarFields(guild, linked)
      : undefined;
    const mapped = mapDiscordEventToIcal(event, guildId, override);
    if (mapped) {
      icalEvents.push(mapped);
    }
  }

  icalEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

  const ics = buildVcalendar(icalEvents);
  return { ics, etag: hashIcs(ics) };
}

/**
 * Personal host calendar: planned events where the user is the host
 * (pending + approved), so hosts can subscribe separately from the full guild feed.
 */
export async function buildHostPlannedEventCalendar(
  guildId: string,
  userId: string,
): Promise<{ ics: string; etag: string } | null> {
  const guild = bot.guilds.cache.get(guildId);
  if (!guild) {
    return null;
  }

  const since = new Date(Date.now() - HOST_FEED_LOOKBACK_MS);
  const events = await prisma.plannedEvent.findMany({
    where: {
      guildId,
      hostId: userId,
      status: {
        in: [PlannedEventStatus.PENDING, PlannedEventStatus.APPROVED],
      },
      startTime: { gte: since },
    },
    orderBy: { startTime: "asc" },
  });

  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { eventLocationChannelId: true },
  });

  let location = FALLBACK_LOCATION;
  if (settings?.eventLocationChannelId) {
    const channel = guild.channels.cache.get(settings.eventLocationChannelId);
    if (channel && "name" in channel && typeof channel.name === "string") {
      location = `#${channel.name}`;
    } else {
      location = "Discord voice";
    }
  }

  const icalEvents: IcalEventInput[] = [];
  for (const event of events) {
    if (isDraftPlaceholderTime(event.startTime)) {
      continue;
    }
    const end = new Date(
      event.startTime.getTime() + event.durationMinutes * 60 * 1000,
    );
    const { summary, description } = await buildPlannedEventCalendarFields(
      guild,
      event,
    );
    const descParts = [
      description,
      "Role: Host",
      `Status: ${event.status}`,
    ];
    if (event.discordEventId) {
      descParts.push(
        `Discord: https://discord.com/events/${guildId}/${event.discordEventId}`,
      );
    }

    icalEvents.push({
      uid: `planned-event-${event.id}@vrcshield.com`,
      summary,
      description: descParts.join("\n"),
      location,
      url: event.discordEventId
        ? `https://discord.com/events/${guildId}/${event.discordEventId}`
        : undefined,
      start: event.startTime,
      end,
    });
  }

  const ics = buildVcalendar(icalEvents);
  return { ics, etag: hashIcs(ics) };
}

export function getPublicApiBaseUrl(): string {
  try {
    return getEnv().PUBLIC_API_BASE_URL.replace(/\/$/, "");
  } catch {
    return "https://api.vrcshield.com";
  }
}

export function getGuildCalendarFeedUrl(guildId: string): string {
  return `${getPublicApiBaseUrl()}/api/events/${guildId}/calendar.ics`;
}

export function getHostCalendarFeedUrl(guildId: string, userId: string): string {
  return `${getPublicApiBaseUrl()}/api/events/${guildId}/host/${userId}/calendar.ics`;
}
