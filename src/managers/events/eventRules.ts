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
  formatEventWeekRangeLabel,
  formatSchedulableWeekRangeLabel,
  getCurrentEventWeekRange,
  getEventWeekRangeForDate,
  getSchedulableEventWeekRange,
} from "./eventWeek.js";
import {
  isDurationAllowedForDuty,
  defaultDurationMinutes,
  formatDurationLabel,
  MAX_OFF_DUTY_DURATION_MINUTES,
  MIN_EVENT_DURATION_MINUTES,
} from "./eventType.js";

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
  /** Exported current-week edits may stay in this week instead of the next schedulable week. */
  allowCurrentEventWeek?: boolean;
  /** Approved exported events may keep a start time that is already in the past. */
  allowPastTime?: boolean;
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

function eventDurationMs(durationMinutes: number): number {
  return durationMinutes * 60 * 1000;
}

function eventEndMs(start: Date, durationMinutes: number): number {
  return start.getTime() + eventDurationMs(durationMinutes);
}

function rangesOverlap(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
): boolean {
  return aStartMs < bEndMs && aEndMs > bStartMs;
}

/** True when new event overlaps another event's runtime (no cooldown buffer). */
function overlapsEventRuntime(
  newStartMs: number,
  newDurationMs: number,
  otherStart: Date,
  otherDurationMinutes: number,
): boolean {
  return rangesOverlap(
    newStartMs,
    newStartMs + newDurationMs,
    otherStart.getTime(),
    eventEndMs(otherStart, otherDurationMinutes),
  );
}

/** True when new event overlaps approved on-duty runtime or its before/after cooldown buffers. */
function conflictsWithApprovedCooldown(
  newStartMs: number,
  newDurationMs: number,
  approvedStart: Date,
  approvedDurationMinutes: number,
): boolean {
  const approvedStartMs = approvedStart.getTime();
  const approvedEndMs = eventEndMs(approvedStart, approvedDurationMinutes);
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
    allowCurrentEventWeek,
    allowPastTime,
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

  const timeInPast = startTime.getTime() <= Date.now();
  if (isDraftPlaceholderTime(startTime) || (!allowPastTime && timeInPast)) {
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
      message: allowPastTime && timeInPast
        ? "Event time is set (already in the past)."
        : "Event time is set.",
    });
  }

  const timeIsSet =
    !isDraftPlaceholderTime(startTime) && (allowPastTime || !timeInPast);

  if (!timeIsSet) {
    return results;
  }

  const newDurationMs = eventDurationMs(
    durationMinutes ?? defaultDurationMinutes(duty),
  );
  const newStartMs = startTime.getTime();
  const newEndMs = newStartMs + newDurationMs;

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
      message: `Start time is not on a Monday (EST) - **${estTimeLabel}**.`,
    });
  }

  const schedulableWeek = getSchedulableEventWeekRange();
  const allowedWeek = allowCurrentEventWeek
    ? getCurrentEventWeekRange()
    : schedulableWeek;
  const startInWindow =
    startTime.getTime() >= allowedWeek.start.getTime() &&
    startTime.getTime() < allowedWeek.end.getTime();
  const endInWindow = newEndMs <= allowedWeek.end.getTime();

  if (!startInWindow || !endInWindow) {
    results.push({
      id: "scheduling-window",
      label: "Scheduling window",
      severity: "fail",
      message: allowCurrentEventWeek
        ? `This exported event must remain in the current event week (${formatEventWeekRangeLabel(allowedWeek)}).`
        : `Events can only be scheduled for ${formatSchedulableWeekRangeLabel()} (Tuesday–Sunday). On Mondays you may plan the current week; otherwise only the next week.`,
    });
  } else {
    results.push({
      id: "scheduling-window",
      label: "Scheduling window",
      severity: "pass",
      message: allowCurrentEventWeek
        ? `Event remains in the current event week (${formatEventWeekRangeLabel(allowedWeek)}).`
        : `Event falls within the allowed scheduling window (${formatSchedulableWeekRangeLabel()}).`,
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

  const approvedEvents = await prisma.plannedEvent.findMany({
    where: {
      guildId,
      status: PlannedEventStatus.APPROVED,
      startTime: { gte: week.start, lt: week.end },
      ...(eventId ? { id: { not: eventId } } : {}),
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      durationMinutes: true,
      planningMessageId: true,
      duty: true,
    },
  });

  const approvedOnDuty = approvedEvents.filter((e) => e.duty === EventDuty.ON_DUTY);
  const approvedOffDuty = approvedEvents.filter(
    (e) => e.duty === EventDuty.OFF_DUTY,
  );

  if (duty === EventDuty.OFF_DUTY) {
    const collidingEvents = approvedEvents.filter((other) =>
      overlapsEventRuntime(
        newStartMs,
        newDurationMs,
        other.startTime,
        other.durationMinutes,
      ),
    );
    if (collidingEvents.length > 0) {
      const links = collidingEvents.map((e) =>
        formatQueuedEventLink(e, guildId, planningChannelId),
      );
      const basis =
        links.length === 1
          ? links[0]
          : `${links.slice(0, -1).join(", ")} and ${links[links.length - 1]}`;
      const hitsOnDuty = collidingEvents.some((e) => e.duty === EventDuty.ON_DUTY);
      const hitsOffDuty = collidingEvents.some((e) => e.duty === EventDuty.OFF_DUTY);
      const target =
        hitsOnDuty && hitsOffDuty
          ? "official on-duty patrols or other off-duty events"
          : hitsOnDuty
            ? "official on-duty patrols"
            : "other off-duty events";
      results.push({
        id: "overlap",
        label: "Event overlap",
        severity: "fail",
        message: `Off-duty events cannot overlap ${target}: ${basis}.`,
      });
    } else {
      results.push({
        id: "overlap",
        label: "Event overlap",
        severity: "pass",
        message:
          "Does not overlap any other events. Off-duty events have no 2-hour cooldown.",
      });
    }
  } else {
    const approvedWithinCooldown = approvedOnDuty.filter((other) =>
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
        message: `This event falls within the 2-hour cooldown after an approved on-duty event ends or before one starts: ${basis}.`,
      });
    } else {
      results.push({
        id: "overlap",
        label: "Event overlap",
        severity: "pass",
        message: "No approved on-duty events within the 2-hour cooldown window.",
      });
    }

    const collidingOffDuty = approvedOffDuty.filter((other) =>
      overlapsEventRuntime(
        newStartMs,
        newDurationMs,
        other.startTime,
        other.durationMinutes,
      ),
    );
    if (collidingOffDuty.length > 0) {
      const links = collidingOffDuty.map((e) =>
        formatQueuedEventLink(e, guildId, planningChannelId),
      );
      const basis =
        links.length === 1
          ? links[0]
          : `${links.slice(0, -1).join(", ")} and ${links[links.length - 1]}`;
      results.push({
        id: "offduty-collision",
        label: "Off-duty overlap",
        severity: "fail",
        message: `This on-duty event overlaps an off-duty event: ${basis}.`,
      });
    }
  }

  const pendingEvents = await prisma.plannedEvent.findMany({
    where: {
      guildId,
      status: PlannedEventStatus.PENDING,
      startTime: { gte: week.start, lt: week.end },
      ...(eventId ? { id: { not: eventId } } : {}),
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      durationMinutes: true,
      planningMessageId: true,
      createdAt: true,
      duty: true,
    },
  });

  const pendingConflicts = pendingEvents
    .filter((other) => {
      if (duty === EventDuty.OFF_DUTY) {
        return overlapsEventRuntime(
          newStartMs,
          newDurationMs,
          other.startTime,
          other.durationMinutes,
        );
      }
      if (other.duty === EventDuty.ON_DUTY) {
        const diff = Math.abs(other.startTime.getTime() - startTime.getTime());
        return diff < TWO_HOURS_MS;
      }
      return overlapsEventRuntime(
        newStartMs,
        newDurationMs,
        other.startTime,
        other.durationMinutes,
      );
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (pendingConflicts.length > 0) {
    const links = pendingConflicts.map((e) =>
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
      message: `Your event may be denied on the basis of ${basis}, which ${pendingConflicts.length === 1 ? "is" : "are"} ahead in the approval queue.`,
    });
  }

  if (coHostId && coHostId === hostId) {
    results.push({
      id: "distinct-host-cohost",
      label: "Host / co-host",
      severity: "fail",
      message: "The host and co-host must be different people.",
    });
  } else if (coHostId) {
    results.push({
      id: "distinct-host-cohost",
      label: "Host / co-host",
      severity: "pass",
      message: "Host and co-host are different people.",
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
          ? "On-duty events must be 2 or 3 hours - 1 hour is not allowed."
          : `Off-duty events must be between ${MIN_EVENT_DURATION_MINUTES} minutes and ${MAX_OFF_DUTY_DURATION_MINUTES / 60} hours.`;
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
    } else {
      results.push({
        id: "duration",
        label: "Duration",
        severity: "pass",
        message:
          duty === EventDuty.OFF_DUTY
            ? `Event duration is ${formatDurationLabel(duration)} (off-duty does not collect hours).`
            : `Event duration is ${formatDurationLabel(duration)}.`,
      });
    }
  }

  return results;
}

const POLICY_RULE_IDS = new Set([
  "monday-ban",
  "scheduling-window",
  "host-weekly-limit",
  "overlap",
  "offduty-collision",
  "fcfs-queue",
  "jr-host-cohost",
  "duration-3h",
]);

export function applyForceOverride(
  results: EventRuleResult[],
  force: boolean,
): { results: EventRuleResult[]; overriddenIds: string[] } {
  if (!force) {
    return { results, overriddenIds: [] };
  }
  const overriddenIds: string[] = [];
  const adjusted = results.map((r) => {
    if (r.severity === "fail" && POLICY_RULE_IDS.has(r.id)) {
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
    return true;
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
