import { Guild, GuildMember } from "discord.js";
import { prisma } from "../../main.js";
import { EventDuty, PlannedEventStatus } from "../../generated/prisma/client.js";
import { formatESTLabel, isMondayEST } from "../../utility/estTime.js";
import { hasNode } from "../../utility/permissionNodes.js";
import {
  isDraftPlaceholderTime,
  isDraftPlaceholderTitle,
} from "./eventDraftDefaults.js";
import {
  buildPlanningMessageUrl,
  formatSchedulableWeekRangeLabel,
  getEventWeekRangeForDate,
  isWithinSchedulableEventWeek,
} from "./eventWeek.js";
import { isDurationAllowedForDuty, defaultDurationMinutes } from "./eventType.js";

export type RuleSeverity = "pass" | "fail" | "warning";

export interface EventRuleResult {
  id: string;
  label: string;
  severity: RuleSeverity;
  message: string;
}

export interface ValidateEventInput {
  guildId: string;
  eventId?: number;
  title: string;
  startTime: Date;
  hostId: string;
  coHostId?: string | null;
  duty: EventDuty;
  force?: boolean;
  guild?: Guild | null;
  durationMinutes?: number;
  planningChannelId?: string | null;
}

function formatQueuedEventLink(
  event: { id: number; title: string; planningMessageId: string | null },
  guildId: string,
  planningChannelId: string | null | undefined,
): string {
  if (event.planningMessageId && planningChannelId) {
    const url = buildPlanningMessageUrl(
      guildId,
      planningChannelId,
      event.planningMessageId,
    );
    return `[${event.title} (#${event.id})](${url})`;
  }
  return `**${event.title}** (#${event.id})`;
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const APPROVED_EVENT_COOLDOWN_MS = TWO_HOURS_MS;
const MAX_EVENT_DURATION_MS = 180 * 60 * 1000;

function eventDurationMs(durationMinutes: number): number {
  return durationMinutes * 60 * 1000;
}

/** True when new event overlaps approved runtime or its before/after cooldown buffers. */
function conflictsWithApprovedCooldown(
  newStartMs: number,
  newDurationMs: number,
  approvedStart: Date,
  approvedDurationMinutes: number,
): boolean {
  const approvedStartMs = approvedStart.getTime();
  const approvedEndMs = approvedStartMs + eventDurationMs(approvedDurationMinutes);
  const newEndMs = newStartMs + newDurationMs;
  return (
    newStartMs < approvedEndMs + APPROVED_EVENT_COOLDOWN_MS &&
    newEndMs + APPROVED_EVENT_COOLDOWN_MS > approvedStartMs
  );
}

const ACTIVE_STATUSES: PlannedEventStatus[] = [
  PlannedEventStatus.PENDING,
  PlannedEventStatus.APPROVED,
];

export async function memberHasHostNode(member: GuildMember): Promise<boolean> {
  return hasNode(member, "roles.host");
}

export async function memberHasJrHostNode(member: GuildMember): Promise<boolean> {
  return hasNode(member, "roles.jrhost");
}

export async function memberIsFullHost(member: GuildMember): Promise<boolean> {
  return memberHasHostNode(member);
}

export async function memberIsJrHostOnly(member: GuildMember): Promise<boolean> {
  const jr = await memberHasJrHostNode(member);
  if (!jr) {
    return false;
  }
  const full = await memberHasHostNode(member);
  return !full;
}

async function fetchHostMember(
  guild: Guild | null | undefined,
  hostId: string,
): Promise<GuildMember | null> {
  if (!guild) {
    return null;
  }
  try {
    return await guild.members.fetch(hostId);
  } catch {
    return null;
  }
}

export async function validateEventRules(
  input: ValidateEventInput,
): Promise<EventRuleResult[]> {
  const results: EventRuleResult[] = [];
  const {
    guildId,
    eventId,
    title,
    startTime,
    hostId,
    coHostId,
    duty,
    guild,
    durationMinutes,
    planningChannelId,
  } = input;

  if (isDraftPlaceholderTitle(title)) {
    results.push({
      id: "title",
      label: "Title",
      severity: "fail",
      message: "Event title must be set before submitting.",
    });
  } else {
    results.push({
      id: "title",
      label: "Title",
      severity: "pass",
      message: "Event title is set.",
    });
  }

  if (isDraftPlaceholderTime(startTime) || startTime.getTime() <= Date.now()) {
    results.push({
      id: "time",
      label: "Time",
      severity: "fail",
      message: "Event time must be set to a future date before submitting.",
    });
  } else {
    results.push({
      id: "time",
      label: "Time",
      severity: "pass",
      message: "Event time is set.",
    });
  }

  const timeIsSet = !isDraftPlaceholderTime(startTime) && startTime.getTime() > Date.now();

  if (!timeIsSet) {
    return results;
  }

  const estTimeLabel = formatESTLabel(startTime);

  if (isMondayEST(startTime)) {
    results.push({
      id: "monday-ban",
      label: "Monday ban",
      severity: "fail",
      message: `Events cannot be scheduled on Mondays (EST). Your selected time is **${estTimeLabel}**.`,
    });
  } else {
    results.push({
      id: "monday-ban",
      label: "Monday ban",
      severity: "pass",
      message: `Start time is not on a Monday (EST) — **${estTimeLabel}**.`,
    });
  }

  if (!isWithinSchedulableEventWeek(startTime)) {
    results.push({
      id: "scheduling-window",
      label: "Scheduling window",
      severity: "fail",
      message: `Events can only be scheduled for ${formatSchedulableWeekRangeLabel()} (Tuesday–Sunday). On Mondays you may plan the current week; otherwise only the next week.`,
    });
  } else {
    results.push({
      id: "scheduling-window",
      label: "Scheduling window",
      severity: "pass",
      message: `Event falls within the allowed scheduling window (${formatSchedulableWeekRangeLabel()}).`,
    });
  }

  const hostMember = await fetchHostMember(guild, hostId);
  if (!hostMember) {
    results.push({
      id: "host-role",
      label: "Host role",
      severity: "fail",
      message: "Could not verify the host's roles in this server.",
    });
  } else {
    const hasHost = await memberHasHostNode(hostMember);
    const hasJr = await memberHasJrHostNode(hostMember);
    if (!hasHost && !hasJr) {
      results.push({
        id: "host-role",
        label: "Host role",
        severity: "fail",
        message: "Host must have the Host or Jr. Host role.",
      });
    } else {
      results.push({
        id: "host-role",
        label: "Host role",
        severity: "pass",
        message: hasHost ? "Host has the full Host role." : "Host has the Jr. Host role.",
      });
    }
  }

  const week = getEventWeekRangeForDate(startTime);
  const hostEvents = await prisma.plannedEvent.findMany({
    where: {
      guildId,
      hostId,
      status: { in: ACTIVE_STATUSES },
      startTime: { gte: week.start, lt: week.end },
      ...(eventId ? { id: { not: eventId } } : {}),
    },
    select: { duty: true },
  });

  const onDutyCount = hostEvents.filter((e) => e.duty === EventDuty.ON_DUTY).length;
  const offDutyCount = hostEvents.filter((e) => e.duty === EventDuty.OFF_DUTY).length;
  const includesCurrent =
    duty === EventDuty.ON_DUTY ? onDutyCount + 1 : offDutyCount + 1;
  const limitDuty = duty === EventDuty.ON_DUTY ? "on-duty" : "off-duty";
  const currentCount = duty === EventDuty.ON_DUTY ? onDutyCount : offDutyCount;

  if (includesCurrent > 3) {
    results.push({
      id: "host-weekly-limit",
      label: "Per-host weekly limit",
      severity: "fail",
      message: `Host already has ${currentCount} ${limitDuty} event(s) this week (max 3).`,
    });
  } else {
    results.push({
      id: "host-weekly-limit",
      label: "Per-host weekly limit",
      severity: "pass",
      message: `Host has ${currentCount}/3 ${limitDuty} events this week.`,
    });
  }

  const newDurationMs = eventDurationMs(
    durationMinutes ?? defaultDurationMinutes(duty),
  );
  const newStartMs = startTime.getTime();
  const newEndMs = newStartMs + newDurationMs;

  const approvedEvents = await prisma.plannedEvent.findMany({
    where: {
      guildId,
      status: PlannedEventStatus.APPROVED,
      startTime: {
        gte: new Date(newStartMs - APPROVED_EVENT_COOLDOWN_MS - MAX_EVENT_DURATION_MS),
        lte: new Date(newEndMs + APPROVED_EVENT_COOLDOWN_MS + MAX_EVENT_DURATION_MS),
      },
      ...(eventId ? { id: { not: eventId } } : {}),
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      durationMinutes: true,
      planningMessageId: true,
    },
  });

  const approvedWithinCooldown = approvedEvents.filter((other) =>
    conflictsWithApprovedCooldown(
      newStartMs,
      newDurationMs,
      other.startTime,
      other.durationMinutes,
    ),
  );

  if (approvedWithinCooldown.length > 0) {
    const links = approvedWithinCooldown.map((e) =>
      formatQueuedEventLink(e, guildId, planningChannelId),
    );
    const basis =
      links.length === 1
        ? links[0]
        : `${links.slice(0, -1).join(", ")} and ${links[links.length - 1]}`;
    results.push({
      id: "overlap",
      label: "Event overlap",
      severity: "fail",
      message: `This event falls within the 2-hour cooldown after an approved event ends or before one starts: ${basis}.`,
    });
  } else {
    results.push({
      id: "overlap",
      label: "Event overlap",
      severity: "pass",
      message: "No approved events within the 2-hour cooldown window.",
    });
  }

  const pendingEvents = await prisma.plannedEvent.findMany({
    where: {
      guildId,
      status: PlannedEventStatus.PENDING,
      startTime: {
        gte: new Date(newStartMs - TWO_HOURS_MS),
        lte: new Date(newEndMs + TWO_HOURS_MS),
      },
      ...(eventId ? { id: { not: eventId } } : {}),
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      planningMessageId: true,
      createdAt: true,
    },
  });

  const pendingWithin2h = pendingEvents
    .filter((other) => {
      const diff = Math.abs(other.startTime.getTime() - startTime.getTime());
      return diff < TWO_HOURS_MS;
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (pendingWithin2h.length > 0) {
    const links = pendingWithin2h.map((e) =>
      formatQueuedEventLink(e, guildId, planningChannelId),
    );
    const basis =
      links.length === 1
        ? links[0]
        : `${links.slice(0, -1).join(", ")} and ${links[links.length - 1]}`;
    results.push({
      id: "fcfs-queue",
      label: "Approval queue (FCFS)",
      severity: "warning",
      message: `Your event may be denied on the basis of ${basis}, which ${pendingWithin2h.length === 1 ? "is" : "are"} ahead in the approval queue.`,
    });
  }

  if (hostMember && (await memberIsJrHostOnly(hostMember))) {
    let coHostFullHost = false;
    if (coHostId && guild) {
      try {
        const coMember = await guild.members.fetch(coHostId);
        coHostFullHost = await memberIsFullHost(coMember);
      } catch {
        coHostFullHost = false;
      }
    }
    if (!coHostFullHost) {
      results.push({
        id: "jr-host-cohost",
        label: "Jr. Host co-host",
        severity: "warning",
        message:
          "Jr. Host events need a full Host as co-host before approval or export.",
      });
    } else {
      results.push({
        id: "jr-host-cohost",
        label: "Jr. Host co-host",
        severity: "pass",
        message: "A full Host is set as co-host.",
      });
    }
  }

  if (durationMinutes !== undefined) {
    const duration = durationMinutes;
    if (!isDurationAllowedForDuty(duration, duty)) {
      const message =
        duty === EventDuty.ON_DUTY
          ? "On-duty events must be 2 or 3 hours — 1 hour is not allowed."
          : "Off-duty events must be 1 or 2 hours — 3 hours is not allowed.";
      results.push({
        id: "duration-invalid",
        label: "Duration",
        severity: "fail",
        message,
      });
    } else if (duty === EventDuty.ON_DUTY && duration === 180) {
      results.push({
        id: "duration-3h",
        label: "3-hour duration",
        severity: "warning",
        message: "3-hour on-duty events require lead approval before export.",
      });
    } else if (duty === EventDuty.OFF_DUTY && duration === 120) {
      results.push({
        id: "duration-2h-offduty",
        label: "2-hour duration",
        severity: "warning",
        message: "2-hour off-duty events require lead approval before export.",
      });
    } else {
      results.push({
        id: "duration",
        label: "Duration",
        severity: "pass",
        message: `Event duration is ${duration / 60} hour(s).`,
      });
    }
  }

  return results;
}

export function applyForceOverride(
  results: EventRuleResult[],
  force: boolean,
): { results: EventRuleResult[]; overriddenIds: string[] } {
  if (!force) {
    return { results, overriddenIds: [] };
  }
  const overriddenIds: string[] = [];
  const adjusted = results.map((r) => {
    if (r.severity === "fail") {
      overriddenIds.push(r.id);
      return {
        ...r,
        severity: "warning" as RuleSeverity,
        message: `${r.message} (overridden by force)`,
      };
    }
    return r;
  });
  return { results: adjusted, overriddenIds };
}

export function hasBlockingFailures(results: EventRuleResult[]): boolean {
  return results.some((r) => r.severity === "fail");
}

export function formatRuleResults(results: EventRuleResult[]): string {
  if (results.length === 0) {
    return "No validation checks run.";
  }
  return results
    .map((r) => {
      const icon =
        r.severity === "pass" ? "✅" : r.severity === "warning" ? "⚠️" : "❌";
      return `${icon} **${r.label}:** ${r.message}`;
    })
    .join("\n");
}

/** Returns true when a Jr. Host event lacks a full-host co-host (blocks approve/export). */
export async function jrHostMissingFullCoHost(
  guild: Guild | null | undefined,
  hostId: string,
  coHostId: string | null | undefined,
): Promise<boolean> {
  if (!guild) {
    return false;
  }
  const hostMember = await fetchHostMember(guild, hostId);
  if (!hostMember || !(await memberIsJrHostOnly(hostMember))) {
    return false;
  }
  if (!coHostId) {
    return true;
  }
  try {
    const coMember = await guild.members.fetch(coHostId);
    return !(await memberIsFullHost(coMember));
  } catch {
    return true;
  }
}
