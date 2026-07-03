import type { AutocompleteInteraction, Guild } from "discord.js";
import type { PlannedEvent, PlannedEventStatus } from "../../generated/prisma/client.js";
import { prisma } from "../../main.js";
import { formatESTLabel } from "../../utility/estTime.js";
import { isDraftPlaceholderTime } from "./eventDraftDefaults.js";

export function formatEventAutocompleteLabel(
  event: PlannedEvent,
  hostLabel: string,
): string {
  const timeLabel = isDraftPlaceholderTime(event.startTime)
    ? "no time set"
    : formatESTLabel(event.startTime);
  const status =
    event.status.charAt(0) + event.status.slice(1).toLowerCase();
  const label = `${event.title} — ${hostLabel} — ${timeLabel} (${status})`;
  return label.length > 100 ? `${label.slice(0, 97)}...` : label;
}

export async function resolveHostLabels(
  guild: Guild | null,
  hostIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(hostIds)];
  const labels = new Map<string, string>();

  if (!guild) {
    for (const id of uniqueIds) {
      labels.set(id, id);
    }
    return labels;
  }

  for (const hostId of uniqueIds) {
    const cached = guild.members.cache.get(hostId);
    if (cached) {
      labels.set(hostId, cached.displayName || cached.user.username);
    } else {
      labels.set(hostId, "Unknown host");
    }
  }

  return labels;
}

export function filterEventsByAutocompleteQuery(
  events: PlannedEvent[],
  query: string,
  hostLabels: Map<string, string>,
): PlannedEvent[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return events;
  }

  return events.filter((event) => {
    const host = (hostLabels.get(event.hostId) ?? "").toLowerCase();
    const time = isDraftPlaceholderTime(event.startTime)
      ? ""
      : formatESTLabel(event.startTime).toLowerCase();
    return (
      event.title.toLowerCase().includes(q) ||
      String(event.id).includes(q) ||
      host.includes(q) ||
      time.includes(q) ||
      event.status.toLowerCase().includes(q) ||
      event.duty.toLowerCase().replace("_", " ").includes(q)
    );
  });
}

export async function respondPlannedEventAutocomplete(
  interaction: AutocompleteInteraction,
  statuses: PlannedEventStatus[],
  options?: {
    /** When true, non-leads only see their own hosted events. */
    restrictToCallerHost?: boolean;
    /** When true, event leads can see all guild events (overrides restrictToCallerHost). */
    leadCanSeeAll?: boolean;
    isLead?: boolean;
  },
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused();
  const restrict =
    options?.restrictToCallerHost &&
    !(options.leadCanSeeAll && options.isLead);

  const events = await prisma.plannedEvent.findMany({
    where: {
      guildId: interaction.guildId,
      status: { in: statuses },
      ...(restrict ? { hostId: interaction.user.id } : {}),
    },
    orderBy: { startTime: "asc" },
  });

  const hostLabels = await resolveHostLabels(
    interaction.guild,
    events.map((e) => e.hostId),
  );
  const filtered = filterEventsByAutocompleteQuery(events, focused, hostLabels);
  const sorted = [...filtered].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  );

  await interaction.respond(
    sorted.slice(0, 25).map((event) => ({
      name: formatEventAutocompleteLabel(
        event,
        hostLabels.get(event.hostId) ?? "Unknown host",
      ),
      value: event.id,
    })),
  );
}
