import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  Colors,
  EmbedBuilder,
  Guild,
  GuildMember,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageActionRowComponentBuilder,
  MessageCreateOptions,
  ModalSubmitInteraction,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
  type GuildScheduledEvent,
} from "discord.js";
import {
  EventDuty,
  EventType,
  PlannedEvent,
  PlannedEventStatus,
  Prisma,
} from "../../generated/prisma/client.js";
import { prisma } from "../../main.js";
import { hasNode } from "../../utility/permissionNodes.js";
import { loggers } from "../../utility/logger.js";
import {
  eventStatusDmEnabled,
  getResolvedUserPreferences,
} from "../../utility/userPreferences.js";
import {
  isDraftPlaceholderTime,
  isDraftPlaceholderTitle,
  normalizeEventTitle,
} from "./eventDraftDefaults.js";
import {
  applyForceOverride,
  formatRuleResults,
  hasBlockingFailures,
  jrHostMissingFullCoHost,
  validateEventRules,
  type EventRuleResult,
} from "./eventRules.js";
import {
  formatOffDutyScheduleMessage,
  formatOnDutyScheduleMessage,
  getScheduleExportSettings,
  resolveOffDutyScheduleChannelId,
  resolveOnDutyScheduleChannelId,
  type ScheduleExportSettings,
} from "./eventScheduleFormatter.js";
import {
  buildPlanningMessageUrl,
  formatEventWeekRangeLabel,
  getCurrentEventWeekRange,
  getExportWeekRangeByChoice,
  getSchedulableEventWeekRange,
  type ExportWeekChoice,
} from "./eventWeek.js";
import {
  formatDurationLabel,
  formatEventTypeDisplay,
} from "./eventType.js";
import { resolveEventMemberDisplayName } from "./eventUserDisplay.js";

/** Fixed External location when no voice channel is configured. */
export const DEFAULT_EXTERNAL_EVENT_LOCATION = "VRChat";

/** Exported edit sessions expire after this long without Save/Cancel. */
export const EXPORTED_EDIT_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

export function isEventLocked(event: PlannedEvent): boolean {
  return event.discordEventId != null;
}

function isExportedEditSessionFresh(event: PlannedEvent, now = new Date()): boolean {
  if (event.editSnapshot == null) {
    return false;
  }
  if (!event.editStartedAt) {
    return false;
  }
  return now.getTime() - event.editStartedAt.getTime() <= EXPORTED_EDIT_SESSION_TTL_MS;
}

/** Drafts, or APPROVED exported events currently open in a fresh edit panel. */
export function isEventPanelEditable(event: PlannedEvent): boolean {
  if (event.status === PlannedEventStatus.DRAFT) {
    return true;
  }
  return (
    event.status === PlannedEventStatus.APPROVED &&
    event.discordEventId != null &&
    isExportedEditSessionFresh(event)
  );
}

export function isExportedEventInCurrentWeek(
  event: PlannedEvent,
  now = new Date(),
): boolean {
  if (event.status !== PlannedEventStatus.APPROVED || !event.discordEventId) {
    return false;
  }
  const { start, end } = getCurrentEventWeekRange(now);
  const t = event.startTime.getTime();
  return t >= start.getTime() && t < end.getTime();
}

export interface EventEditSnapshot {
  title: string;
  startTime: string;
  hostId: string;
  coHostId: string | null;
  coHostOpen: boolean;
  duty: EventDuty;
  eventType: EventType | null;
  durationMinutes: number;
  forceOverride: boolean;
}

export function buildEventEditSnapshot(event: PlannedEvent): EventEditSnapshot {
  return {
    title: event.title,
    startTime: event.startTime.toISOString(),
    hostId: event.hostId,
    coHostId: event.coHostId,
    coHostOpen: event.coHostOpen,
    duty: event.duty,
    eventType: event.eventType,
    durationMinutes: event.durationMinutes,
    forceOverride: event.forceOverride,
  };
}

function parseEventEditSnapshot(raw: unknown): EventEditSnapshot | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const s = raw as Record<string, unknown>;
  if (
    typeof s.title !== "string" ||
    typeof s.startTime !== "string" ||
    typeof s.hostId !== "string" ||
    typeof s.coHostOpen !== "boolean" ||
    typeof s.durationMinutes !== "number" ||
    typeof s.forceOverride !== "boolean" ||
    (s.duty !== EventDuty.ON_DUTY && s.duty !== EventDuty.OFF_DUTY)
  ) {
    return null;
  }
  const eventType =
    s.eventType === null || s.eventType === undefined
      ? null
      : Object.values(EventType).includes(s.eventType as EventType)
        ? (s.eventType as EventType)
        : null;
  return {
    title: s.title,
    startTime: s.startTime,
    hostId: s.hostId,
    coHostId: typeof s.coHostId === "string" ? s.coHostId : null,
    coHostOpen: s.coHostOpen,
    duty: s.duty,
    eventType,
    durationMinutes: s.durationMinutes,
    forceOverride: s.forceOverride,
  };
}

/** Restore editable fields from a snapshot and clear edit-session state. */
async function restoreEventFromSnapshot(
  event: PlannedEvent,
  snapshot: EventEditSnapshot,
): Promise<PlannedEvent> {
  return prisma.plannedEvent.update({
    where: { id: event.id },
    data: {
      title: snapshot.title,
      startTime: new Date(snapshot.startTime),
      hostId: snapshot.hostId,
      coHostId: snapshot.coHostId,
      coHostOpen: snapshot.coHostOpen,
      duty: snapshot.duty,
      eventType: snapshot.eventType,
      durationMinutes: snapshot.durationMinutes,
      forceOverride: snapshot.forceOverride,
      editResumeStatus: null,
      editSnapshot: Prisma.DbNull,
      editStartedAt: null,
    },
  });
}

/**
 * If an exported edit session is stale, restore the snapshot and clear edit state.
 * Returns the (possibly restored) event.
 */
export async function cleanupStaleExportedEditSession(
  event: PlannedEvent,
): Promise<PlannedEvent> {
  if (
    event.status !== PlannedEventStatus.APPROVED ||
    event.editSnapshot == null ||
    isExportedEditSessionFresh(event)
  ) {
    return event;
  }

  const snapshot = parseEventEditSnapshot(event.editSnapshot);
  if (!snapshot) {
    return prisma.plannedEvent.update({
      where: { id: event.id },
      data: {
        editResumeStatus: null,
        editSnapshot: Prisma.DbNull,
        editStartedAt: null,
      },
    });
  }

  return restoreEventFromSnapshot(event, snapshot);
}

export async function resolveEventLocationChannelId(
  guild: Guild,
  channelId: string | null | undefined,
): Promise<string | null> {
  if (!channelId) {
    return null;
  }
  try {
    const channel = await guild.channels.fetch(channelId);
    if (
      channel &&
      channel.type === ChannelType.GuildVoice
    ) {
      return channel.id;
    }
  } catch {
    // missing channel
  }
  loggers.bot.warn(
    `Configured event location channel ${channelId} is missing or not voice; falling back to External "${DEFAULT_EXTERNAL_EVENT_LOCATION}"`,
  );
  return null;
}

import { buildDiscordScheduledEventName } from "./eventCalendarNaming.js";

async function buildDiscordEventDescription(
  guild: Guild,
  event: PlannedEvent,
): Promise<string> {
  const hostName = await resolveEventMemberDisplayName(guild, event.hostId);
  const lines = [`Host: ${hostName}`];
  if (event.coHostId) {
    lines.push(
      `Co-host: ${await resolveEventMemberDisplayName(guild, event.coHostId)}`,
    );
  }
  lines.push(`Duty: ${dutyLabel(event.duty)}`);
  return lines.join("\n");
}

function assertEventInGuild(event: PlannedEvent, guildId: string): boolean {
  return event.guildId === guildId;
}

export const EVENT_COLORS = {
  draft: Colors.Blurple,
  pending: Colors.Orange,
  approved: Colors.Green,
  denied: Colors.Red,
} as const;

export {
  DRAFT_PLACEHOLDER_TITLE,
  DRAFT_PLACEHOLDER_TIME_MS,
  isDraftPlaceholderTitle,
  isDraftPlaceholderTime,
  normalizeEventTitle,
  resolveDraftStartTime,
} from "./eventDraftDefaults.js";

type DraftPanelInteraction =
  | ButtonInteraction
  | UserSelectMenuInteraction
  | ModalSubmitInteraction;

/** Ephemeral draft panels must be updated via editReply, not message.edit. */
export async function editDraftPanelMessage(
  interaction: DraftPanelInteraction,
  embed: EmbedBuilder,
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[],
): Promise<void> {
  const payload = {
    content: null,
    embeds: [embed],
    components,
  };

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
      return;
    }
    if (interaction.isMessageComponent() && interaction.message.editable) {
      await interaction.message.edit(payload);
    }
  } catch (error) {
    loggers.bot.error("Failed to update draft panel message", error);
  }
}

/** Persisted per draft; cleared after submit for approval. */
export async function setEventForceOverride(
  eventId: number,
  force: boolean,
): Promise<void> {
  await prisma.plannedEvent.update({
    where: { id: eventId },
    data: { forceOverride: force },
  });
}

export function getEventForceOverride(event: PlannedEvent): boolean {
  return event.forceOverride;
}

export async function clearEventForceOverride(eventId: number): Promise<void> {
  await setEventForceOverride(eventId, false);
}

/** Prevent concurrent double-export per guild. */
const exportLocks = new Set<string>();

function dutyLabel(duty: EventDuty): string {
  return duty === EventDuty.ON_DUTY ? "On-duty" : "Off-duty";
}

export async function runEventValidation(
  event: PlannedEvent,
  guild: Guild | null,
  force?: boolean,
): Promise<{ results: EventRuleResult[]; overriddenIds: string[] }> {
  const useForce = force ?? getEventForceOverride(event);
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId: event.guildId },
    select: { eventPlanningChannelId: true },
  });
  const raw = await validateEventRules({
    guildId: event.guildId,
    eventId: event.id,
    title: event.title,
    startTime: event.startTime,
    hostId: event.hostId,
    coHostId: event.coHostId,
    duty: event.duty,
    force: useForce,
    guild,
    durationMinutes: event.durationMinutes,
    planningChannelId: settings?.eventPlanningChannelId ?? null,
  });
  return applyForceOverride(raw, useForce);
}

function formatEventTimeField(startTime: Date): string {
  if (isDraftPlaceholderTime(startTime)) {
    return "*(not set)*";
  }
  const unix = Math.floor(startTime.getTime() / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

function buildSummaryFields(event: PlannedEvent): EmbedBuilder {
  const title = isDraftPlaceholderTitle(event.title)
    ? "*(not set)*"
    : event.title;
  const embed = new EmbedBuilder().setTitle(title).addFields(
    { name: "Time", value: formatEventTimeField(event.startTime), inline: false },
    { name: "Host", value: `<@${event.hostId}>`, inline: true },
  );
  if (event.coHostId) {
    embed.addFields({
      name: "Co-host",
      value: `<@${event.coHostId}>`,
      inline: true,
    });
  }
  embed.addFields(
    { name: "Duty", value: dutyLabel(event.duty), inline: true },
    { name: "Type", value: formatEventTypeDisplay(event), inline: true },
    {
      name: "Duration",
      value: formatDurationLabel(event.durationMinutes),
      inline: true,
    },
  );
  return embed;
}

export function buildDraftPanelEmbed(
  event: PlannedEvent,
  ruleResults: EventRuleResult[],
  overriddenIds: string[],
): EmbedBuilder {
  const editingExported = isEventPanelEditable(event) && isEventLocked(event);
  const embed = buildSummaryFields(event)
    .setColor(editingExported ? EVENT_COLORS.approved : EVENT_COLORS.draft)
    .setFooter({
      text: editingExported
        ? `Event #${event.id} - Editing exported event`
        : `Event #${event.id} - Draft`,
    });

  embed.addFields({
    name: "Validation",
    value: formatRuleResults(ruleResults),
  });

  if (overriddenIds.length > 0) {
    embed.addFields({
      name: "Force overrides",
      value: overriddenIds.map((id) => `\`${id}\``).join(", "),
    });
  }

  return embed;
}

export function buildPlanningEmbed(
  event: PlannedEvent,
  options?: { overriddenIds?: string[]; denialReason?: string | null },
): EmbedBuilder {
  const color: number =
    event.status === PlannedEventStatus.APPROVED
      ? EVENT_COLORS.approved
      : event.status === PlannedEventStatus.DENIED
        ? EVENT_COLORS.denied
        : event.status === PlannedEventStatus.DRAFT
          ? EVENT_COLORS.draft
          : EVENT_COLORS.pending;
  let statusText = "Pending approval";

  if (event.status === PlannedEventStatus.APPROVED) {
    statusText = "Approved";
  } else if (event.status === PlannedEventStatus.DENIED) {
    statusText = "Denied";
  } else if (event.status === PlannedEventStatus.DRAFT) {
    statusText = "Being edited";
  }

  const embed = buildSummaryFields(event)
    .setColor(color)
    .setFooter({
      text: isEventLocked(event)
        ? isExportedEventInCurrentWeek(event)
          ? `Event #${event.id} - ${statusText} (exported - editable this week)`
          : `Event #${event.id} - ${statusText} (exported - locked)`
        : `Event #${event.id} - ${statusText}`,
    });

  if (event.reviewedById && event.status === PlannedEventStatus.APPROVED) {
    embed.addFields({
      name: "Approved by",
      value: `<@${event.reviewedById}>`,
    });
  }

  if (event.status === PlannedEventStatus.DENIED && options?.denialReason) {
    embed.addFields({
      name: "Denial reason",
      value: options.denialReason,
    });
  }

  if (options?.overriddenIds && options.overriddenIds.length > 0) {
    embed.addFields({
      name: "Force overrides",
      value: options.overriddenIds.map((id) => `\`${id}\``).join(", "),
    });
  }

  return embed;
}

export function buildDraftPanelComponents(
  event: PlannedEvent,
  ruleResults: EventRuleResult[],
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const blocking = hasBlockingFailures(ruleResults);
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`event-panel:title:${event.id}`)
        .setLabel("Edit Title")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`event-panel:time:${event.id}`)
        .setLabel("Edit Time")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`event-panel:toggle-duty:${event.id}`)
        .setLabel(`Duty: ${dutyLabel(event.duty)}`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`event-panel:toggle-cohost-open:${event.id}`)
        .setLabel(event.coHostOpen ? "Co-host: Open" : "Co-host: Closed")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  const typeLabel = `Type: ${formatEventTypeDisplay(event)}`;
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`event-panel:toggle-type:${event.id}`)
        .setLabel(typeLabel.length > 80 ? typeLabel.slice(0, 77) + "..." : typeLabel)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`event-panel:toggle-duration:${event.id}`)
        .setLabel(`Duration: ${formatDurationLabel(event.durationMinutes)}`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`event-panel:toggle-force:${event.id}`)
        .setLabel(event.forceOverride ? "Force: On" : "Force: Off")
        .setStyle(event.forceOverride ? ButtonStyle.Danger : ButtonStyle.Secondary),
    ),
  );

  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`event-panel-select:host:${event.id}`)
        .setPlaceholder("Select host")
        .setMinValues(1)
        .setMaxValues(1),
    ),
  );

  if (!event.coHostOpen) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`event-panel-select:cohost:${event.id}`)
          .setPlaceholder("Select co-host (optional)")
          .setMinValues(0)
          .setMaxValues(1),
      ),
    );
  }

  const editingExported = isEventLocked(event) && event.editSnapshot != null;
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          editingExported
            ? `event-panel:save:${event.id}`
            : `event-panel:submit:${event.id}`,
        )
        .setLabel(editingExported ? "Save changes" : "Submit for approval")
        .setStyle(ButtonStyle.Success)
        .setDisabled(blocking),
      new ButtonBuilder()
        .setCustomId(`event-panel:cancel:${event.id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`event-panel:cancel-delete:${event.id}`)
        .setLabel("Cancel and Delete")
        .setStyle(ButtonStyle.Danger),
    ),
  );

  return rows;
}

function appendCoHostRequestComponents(
  rows: ActionRowBuilder<MessageActionRowComponentBuilder>[],
  event: PlannedEvent,
): void {
  if (isEventLocked(event) || !event.coHostOpen || event.coHostId) {
    return;
  }

  if (!event.pendingCoHostUserId) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`event:cohost:${event.id}`)
          .setLabel("Request Co-host")
          .setStyle(ButtonStyle.Primary),
      ),
    );
    return;
  }

  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`event:cohost:${event.id}`)
        .setLabel("Request Co-host")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
    ),
  );
}

export function buildPlanningComponents(
  event: PlannedEvent,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  if (event.status === PlannedEventStatus.PENDING) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`event:approve:${event.id}`)
          .setLabel("Approve")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`event:deny:${event.id}`)
          .setLabel("Deny")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`event:edit:${event.id}`)
          .setLabel("Edit")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`event:cancel:${event.id}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Danger),
      ),
    );

    appendCoHostRequestComponents(rows, event);
  } else if (event.status === PlannedEventStatus.DENIED) {
    if (!isEventLocked(event)) {
      rows.push(
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`event:edit:${event.id}`)
            .setLabel("Edit & Resubmit")
            .setStyle(ButtonStyle.Primary),
        ),
      );
    }
  } else if (event.status === PlannedEventStatus.APPROVED) {
    const approvedButtons: ButtonBuilder[] = [];
    if (isExportedEventInCurrentWeek(event)) {
      approvedButtons.push(
        new ButtonBuilder()
          .setCustomId(`event:edit:${event.id}`)
          .setLabel("Edit")
          .setStyle(ButtonStyle.Secondary),
      );
    }
    approvedButtons.push(
      new ButtonBuilder()
        .setCustomId(`event:cancel:${event.id}`)
        .setLabel("Cancel Event")
        .setStyle(ButtonStyle.Danger),
    );
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        ...approvedButtons,
      ),
    );

    appendCoHostRequestComponents(rows, event);
  }

  return rows;
}

export async function canUserCancelPlannedEvent(
  userId: string,
  member: GuildMember | null,
  event: PlannedEvent,
): Promise<boolean> {
  if (
    event.status !== PlannedEventStatus.PENDING &&
    event.status !== PlannedEventStatus.APPROVED
  ) {
    return false;
  }
  if (userId === event.hostId) {
    return true;
  }
  if (member && (await hasNode(member, "events.manage.approve"))) {
    return true;
  }
  return false;
}

/** Host, or anyone with events.schedule.behalf, may edit/submit drafts. */
export async function canManageEventDraft(
  userId: string,
  member: GuildMember | null,
  eventHostId: string,
): Promise<boolean> {
  if (userId === eventHostId) {
    return true;
  }
  if (member && (await hasNode(member, "events.schedule.behalf"))) {
    return true;
  }
  return false;
}

/** Host/behalf, or event leads (`events.manage.approve`) - used by panel modals/selects. */
export async function canEditEventPanel(
  userId: string,
  member: GuildMember | null,
  eventHostId: string,
): Promise<boolean> {
  if (await canManageEventDraft(userId, member, eventHostId)) {
    return true;
  }
  return !!(member && (await hasNode(member, "events.manage.approve")));
}

/**
 * Atomic where-clause for panel field writes: DRAFT, or a fresh exported-edit session.
 * Use with updateMany; treat count === 0 as no-longer-editable.
 */
export function editablePanelUpdateWhere(eventId: number) {
  const sessionFloor = new Date(Date.now() - EXPORTED_EDIT_SESSION_TTL_MS);
  return {
    id: eventId,
    OR: [
      { status: PlannedEventStatus.DRAFT },
      {
        status: PlannedEventStatus.APPROVED,
        discordEventId: { not: null },
        editSnapshot: { not: Prisma.DbNull },
        editStartedAt: { gte: sessionFloor },
      },
    ],
  };
}

export async function refreshDraftPanel(
  eventId: number,
  guild: Guild | null,
): Promise<{
  embed: EmbedBuilder;
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}> {
  const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    throw new Error("Event not found");
  }
  const { results, overriddenIds } = await runEventValidation(event, guild);
  return {
    embed: buildDraftPanelEmbed(event, results, overriddenIds),
    components: buildDraftPanelComponents(event, results),
  };
}

export async function updatePlanningChannelMessage(
  guild: Guild,
  event: PlannedEvent,
  options?: { overriddenIds?: string[] },
): Promise<void> {
  if (!event.planningMessageId) {
    return;
  }

  const settings = await prisma.guildSettings.findUnique({
    where: { guildId: event.guildId },
  });
  const channelId = settings?.eventPlanningChannelId;
  if (!channelId) {
    return;
  }

  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      return;
    }
    const message = await channel.messages.fetch(event.planningMessageId);
    const embed = buildPlanningEmbed(event, {
      overriddenIds: options?.overriddenIds,
      denialReason: event.denialReason,
    });
    await message.edit({
      embeds: [embed],
      components: buildPlanningComponents(event),
    });
  } catch (error) {
    loggers.bot.error(`Failed to update planning message for event ${event.id}`, error);
  }
}

export interface NotifyHostOptions {
  overriddenIds?: string[];
  denialReason?: string | null;
  embedColor?: number;
  embedFooter?: string;
}

async function resolvePlanningMessageUrl(
  guildId: string,
  planningMessageId: string | null | undefined,
): Promise<string | null> {
  if (!planningMessageId) {
    return null;
  }
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { eventPlanningChannelId: true },
  });
  if (!settings?.eventPlanningChannelId) {
    return null;
  }
  return buildPlanningMessageUrl(
    guildId,
    settings.eventPlanningChannelId,
    planningMessageId,
  );
}

export async function notifyHost(
  guild: Guild,
  event: PlannedEvent,
  content: string,
  options?: NotifyHostOptions,
): Promise<void> {
  const prefs = await getResolvedUserPreferences(event.hostId);
  if (!eventStatusDmEnabled(prefs)) {
    return;
  }

  let embed = buildPlanningEmbed(event, {
    overriddenIds: options?.overriddenIds,
    denialReason: options?.denialReason ?? event.denialReason,
  });
  if (options?.embedColor !== undefined) {
    embed = embed.setColor(options.embedColor);
  }
  if (options?.embedFooter) {
    embed = embed.setFooter({ text: options.embedFooter });
  }

  const messageUrl = await resolvePlanningMessageUrl(
    guild.id,
    event.planningMessageId,
  );
  const textParts = [content];
  if (messageUrl) {
    textParts.push(`\n\n[View planning message](${messageUrl}) for more details.`);
  }

  const payload = {
    content: textParts.join(""),
    embeds: [embed],
  };

  try {
    const user = await guild.client.users.fetch(event.hostId);
    await user.send(payload);
  } catch {
    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: guild.id },
      });
      const channelId = settings?.eventPlanningChannelId;
      if (channelId) {
        const channel = await guild.channels.fetch(channelId);
        if (channel?.isTextBased()) {
          await channel.send({
            content: `<@${event.hostId}> ${textParts.join("")}`,
            embeds: [embed],
            allowedMentions: { users: [event.hostId], parse: [] },
          });
        }
      }
    } catch (error) {
      loggers.bot.debug(`Could not notify host ${event.hostId}`, error);
    }
  }
}

export async function submitEventForApproval(
  eventId: number,
  guild: Guild,
): Promise<{ success: boolean; error?: string; event?: PlannedEvent }> {
  const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    return { success: false, error: "Event not found." };
  }
  if (!assertEventInGuild(event, guild.id)) {
    return { success: false, error: "Event not found." };
  }

  if (
    event.status !== PlannedEventStatus.DRAFT &&
    event.status !== PlannedEventStatus.DENIED
  ) {
    return { success: false, error: "This event cannot be submitted." };
  }

  const { results, overriddenIds } = await runEventValidation(event, guild);
  if (hasBlockingFailures(results)) {
    return { success: false, error: "Blocking validation failures must be resolved first." };
  }

  const settings = await prisma.guildSettings.findUnique({
    where: { guildId: event.guildId },
  });
  if (!settings?.eventPlanningChannelId) {
    return {
      success: false,
      error: "Event planning channel is not configured. Ask staff to run `/settings events planning-channel`.",
    };
  }

  const channel = await guild.channels.fetch(settings.eventPlanningChannelId);
  if (!channel?.isTextBased()) {
    return { success: false, error: "Event planning channel is invalid." };
  }

  const normalizedTitle = normalizeEventTitle(event.title);
  const pendingPreview: PlannedEvent = {
    ...event,
    title: normalizedTitle,
    status: PlannedEventStatus.PENDING,
    denialReason: null,
    reviewedById: null,
  };
  const embed = buildPlanningEmbed(pendingPreview, { overriddenIds });
  const components = buildPlanningComponents(pendingPreview);

  const previousMessageId = event.planningMessageId;
  const msg = await channel.send({ embeds: [embed], components });
  const messageId = msg.id;

  const submitted = await prisma.plannedEvent.updateMany({
    where: {
      id: eventId,
      guildId: guild.id,
      status: { in: [PlannedEventStatus.DRAFT, PlannedEventStatus.DENIED] },
    },
    data: {
      title: normalizedTitle,
      status: PlannedEventStatus.PENDING,
      denialReason: null,
      reviewedById: null,
      planningMessageId: messageId,
      editResumeStatus: null,
      editSnapshot: Prisma.DbNull,
      editStartedAt: null,
    },
  });
  if (submitted.count === 0) {
    await channel.messages.delete(messageId).catch(() => null);
    return { success: false, error: "This event is no longer editable." };
  }

  if (previousMessageId && previousMessageId !== messageId) {
    await channel.messages.delete(previousMessageId).catch(() => null);
  }

  const finalEvent = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
  if (!finalEvent) {
    return { success: false, error: "Event not found after submission." };
  }
  await notifyHost(
    guild,
    finalEvent,
    `📋 Your event **${finalEvent.title}** was submitted for approval.`,
    { overriddenIds },
  );

  return {
    success: true,
    event: finalEvent,
  };
}

export async function approvePlannedEvent(
  eventId: number,
  reviewerId: string,
  guild: Guild,
): Promise<{ success: boolean; error?: string }> {
  const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
  if (!event || event.status !== PlannedEventStatus.PENDING) {
    return { success: false, error: "Event is not pending approval." };
  }
  if (!assertEventInGuild(event, guild.id)) {
    return { success: false, error: "Event not found." };
  }

  if (isEventLocked(event)) {
    return { success: false, error: "This event has been exported and is locked." };
  }

  const { results } = await runEventValidation(event, guild);
  if (hasBlockingFailures(results)) {
    return {
      success: false,
      error: "Blocking validation failures must be resolved before approval.",
    };
  }

  if (await jrHostMissingFullCoHost(guild, event.hostId, event.coHostId)) {
    return {
      success: false,
      error: "Jr. Host events require a full Host as co-host before approval.",
    };
  }

  const updated = await prisma.plannedEvent.update({
    where: { id: eventId },
    data: {
      status: PlannedEventStatus.APPROVED,
      reviewedById: reviewerId,
      denialReason: null,
      forceOverride: false,
    },
  });

  await updatePlanningChannelMessage(guild, updated);
  await notifyHost(
    guild,
    updated,
    `✅ Your event **${event.title}** has been approved!`,
  );

  return { success: true };
}

export async function denyPlannedEvent(
  eventId: number,
  reviewerId: string,
  reason: string,
  guild: Guild,
): Promise<{ success: boolean; error?: string }> {
  const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
  if (!event || event.status !== PlannedEventStatus.PENDING) {
    return { success: false, error: "Event is not pending approval." };
  }
  if (!assertEventInGuild(event, guild.id)) {
    return { success: false, error: "Event not found." };
  }

  if (isEventLocked(event)) {
    return { success: false, error: "This event has been exported and is locked." };
  }

  const updated = await prisma.plannedEvent.update({
    where: { id: eventId },
    data: {
      status: PlannedEventStatus.DENIED,
      reviewedById: reviewerId,
      denialReason: reason,
      pendingCoHostUserId: null,
    },
  });

  await updatePlanningChannelMessage(guild, updated);

  await clearCoHostRequestMessage(guild, updated);

  await notifyHost(
    guild,
    updated,
    `❌ Your event **${event.title}** was denied.\n\n**Reason:** ${reason}`,
    { denialReason: reason },
  );

  return { success: true };
}

export async function beginEventEditForHost(
  eventId: number,
  guild: Guild,
  userId: string,
  member: GuildMember | null = null,
): Promise<{ success: boolean; error?: string }> {
  const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
  if (!event || event.guildId !== guild.id) {
    return { success: false, error: "Event not found." };
  }

  if (isExportedEventInCurrentWeek(event)) {
    if (!(await canEditExportedEvent(userId, member, event))) {
      return {
        success: false,
        error:
          "Only the event host or event leads can edit this exported event.",
      };
    }
    const cleaned = await cleanupStaleExportedEditSession(event);
    if (cleaned.editSnapshot != null && isExportedEditSessionFresh(cleaned)) {
      return { success: true };
    }
    await prisma.plannedEvent.update({
      where: { id: eventId },
      data: {
        editResumeStatus: PlannedEventStatus.APPROVED,
        editSnapshot: buildEventEditSnapshot(cleaned) as unknown as Prisma.InputJsonValue,
        editStartedAt: new Date(),
      },
    });
    return { success: true };
  }

  if (
    event.status !== PlannedEventStatus.PENDING &&
    event.status !== PlannedEventStatus.DENIED
  ) {
    return {
      success: false,
      error:
        "Only pending, denied, or current-week exported events can be edited.",
    };
  }
  if (!(await canManageEventDraft(userId, member, event.hostId))) {
    return {
      success: false,
      error:
        "Only the event host (or someone with events.schedule.behalf) can edit this event.",
    };
  }
  if (isEventLocked(event)) {
    return { success: false, error: "Exported events cannot be edited." };
  }

  const reopened = await reopenUnapprovedEventForEdit(eventId, guild.id);
  if (!reopened) {
    return { success: false, error: "Could not reopen event for editing." };
  }

  if (event.coHostRequestMessageId) {
    await clearCoHostRequestMessage(guild, event);
  }

  await updatePlanningChannelMessage(guild, reopened);
  return { success: true };
}

export async function canEditExportedEvent(
  userId: string,
  member: GuildMember | null,
  event: PlannedEvent,
): Promise<boolean> {
  if (!isExportedEventInCurrentWeek(event)) {
    return false;
  }
  if (userId === event.hostId) {
    return true;
  }
  if (member && (await hasNode(member, "events.manage.approve"))) {
    return true;
  }
  return false;
}

export async function reopenUnapprovedEventForEdit(
  eventId: number,
  guildId: string,
): Promise<PlannedEvent | null> {
  const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
  if (!event || !assertEventInGuild(event, guildId) || isEventLocked(event)) {
    return null;
  }
  if (
    event.status !== PlannedEventStatus.PENDING &&
    event.status !== PlannedEventStatus.DENIED
  ) {
    return null;
  }
  return prisma.plannedEvent.update({
    where: { id: eventId },
    data: {
      status: PlannedEventStatus.DRAFT,
      editResumeStatus: event.status,
      pendingCoHostUserId: null,
    },
  });
}

export async function reopenDeniedEventForEdit(
  eventId: number,
  guildId: string,
): Promise<PlannedEvent | null> {
  return reopenUnapprovedEventForEdit(eventId, guildId);
}

/** Non-destructive Cancel on the draft/edit panel. */
export async function abortEventPanelEdit(
  eventId: number,
  guild: Guild,
): Promise<{ success: boolean; error?: string; message?: string }> {
  const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
  if (!event || !assertEventInGuild(event, guild.id)) {
    return { success: false, error: "Event not found." };
  }

  if (event.status === PlannedEventStatus.APPROVED && event.editSnapshot != null) {
    const snapshot = parseEventEditSnapshot(event.editSnapshot);
    if (!snapshot) {
      return { success: false, error: "Could not restore event snapshot." };
    }
    const restored = await restoreEventFromSnapshot(event, snapshot);
    await updatePlanningChannelMessage(guild, restored);
    return { success: true, message: "Editing cancelled." };
  }

  if (
    event.status === PlannedEventStatus.DRAFT &&
    (event.editResumeStatus === PlannedEventStatus.PENDING ||
      event.editResumeStatus === PlannedEventStatus.DENIED)
  ) {
    const resumeStatus = event.editResumeStatus;
    const restored = await prisma.plannedEvent.update({
      where: { id: eventId },
      data: {
        status: resumeStatus,
        editResumeStatus: null,
        editSnapshot: Prisma.DbNull,
        editStartedAt: null,
      },
    });
    await updatePlanningChannelMessage(guild, restored);
    return { success: true, message: "Editing cancelled." };
  }

  if (event.status === PlannedEventStatus.DRAFT) {
    return {
      success: true,
      message:
        "Panel closed. The draft was kept - use Cancel and Delete to remove it.",
    };
  }

  return { success: false, error: "This event cannot be cancelled from the panel." };
}

/** Cancel and Delete from the draft/edit panel. */
export async function cancelAndDeleteFromPanel(
  eventId: number,
  guild: Guild,
  userId: string,
): Promise<{ success: boolean; error?: string; message?: string }> {
  const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
  if (!event || !assertEventInGuild(event, guild.id)) {
    return { success: false, error: "Event not found." };
  }

  if (event.status === PlannedEventStatus.APPROVED && event.discordEventId) {
    const result = await cancelPlannedEvent(eventId, guild, userId);
    if (!result.success) {
      return result;
    }
    return {
      success: true,
      message: "Event cancelled and deleted.",
    };
  }

  if (event.status !== PlannedEventStatus.DRAFT) {
    return { success: false, error: "Only draft or exported events can be deleted from this panel." };
  }

  const deleted = await prisma.plannedEvent.deleteMany({
    where: {
      id: eventId,
      status: PlannedEventStatus.DRAFT,
    },
  });
  if (deleted.count === 0) {
    return { success: false, error: "This event is no longer editable." };
  }
  return { success: true, message: "Draft cancelled and deleted." };
}

/** Save changes for an exported APPROVED event and sync Discord. */
export async function saveExportedEventChanges(
  eventId: number,
  guild: Guild,
): Promise<{ success: boolean; error?: string }> {
  const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
  if (!event || !assertEventInGuild(event, guild.id)) {
    return { success: false, error: "Event not found." };
  }
  if (
    event.status !== PlannedEventStatus.APPROVED ||
    !event.discordEventId ||
    event.editSnapshot == null
  ) {
    return { success: false, error: "This event is not open for exported editing." };
  }

  const { results } = await runEventValidation(event, guild);
  if (hasBlockingFailures(results)) {
    return {
      success: false,
      error: "Blocking validation failures must be resolved before saving.",
    };
  }

  if (await jrHostMissingFullCoHost(guild, event.hostId, event.coHostId)) {
    return {
      success: false,
      error: "Jr. Host events require a full Host as co-host.",
    };
  }

  const sync = await updateDiscordScheduledEvent(guild, event);
  if (!sync.success) {
    return sync;
  }

  const updated = await prisma.plannedEvent.update({
    where: { id: eventId },
    data: {
      editResumeStatus: null,
      editSnapshot: Prisma.DbNull,
      editStartedAt: null,
      forceOverride: false,
    },
  });
  await updatePlanningChannelMessage(guild, updated);
  return { success: true };
}

export function getUpcomingWeekRange(now = new Date()): { start: Date; end: Date } {
  return getSchedulableEventWeekRange(now);
}

export async function clearCoHostRequestMessage(
  guild: Guild,
  event: PlannedEvent,
): Promise<void> {
  if (!event.coHostRequestMessageId) {
    return;
  }
  try {
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: event.guildId },
    });
    if (settings?.eventPlanningChannelId) {
      const channel = await guild.channels.fetch(settings.eventPlanningChannelId);
      if (channel?.isTextBased()) {
        const reqMsg = await channel.messages.fetch(event.coHostRequestMessageId);
        await reqMsg.delete().catch(() => null);
      }
    }
  } catch {
    // ignore
  }
}

export async function cancelPlannedEvent(
  eventId: number,
  guild: Guild,
  cancelledById: string,
): Promise<{ success: boolean; error?: string }> {
  const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    return { success: false, error: "Event not found." };
  }
  if (!assertEventInGuild(event, guild.id)) {
    return { success: false, error: "Event not found." };
  }
  if (
    event.status !== PlannedEventStatus.PENDING &&
    event.status !== PlannedEventStatus.APPROVED
  ) {
    return {
      success: false,
      error: "Only pending or approved events can be cancelled.",
    };
  }

  const member = await guild.members.fetch(cancelledById).catch(() => null);
  if (!(await canUserCancelPlannedEvent(cancelledById, member, event))) {
    return {
      success: false,
      error: "Only the event host or event leads can cancel this event.",
    };
  }

  if (event.discordEventId) {
    try {
      const scheduled = await guild.scheduledEvents.fetch(event.discordEventId);
      await scheduled.delete();
    } catch (error) {
      loggers.bot.warn(
        `Could not delete Discord scheduled event ${event.discordEventId} for planned event ${event.id}`,
        error,
      );
      return {
        success: false,
        error:
          "Could not delete the Discord scheduled event. The event was not cancelled.",
      };
    }
  }

  await clearCoHostRequestMessage(guild, event);

  if (event.planningMessageId) {
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: event.guildId },
    });
    const channelId = settings?.eventPlanningChannelId;
    if (channelId) {
      try {
        const channel = await guild.channels.fetch(channelId);
        if (channel?.isTextBased()) {
          const message = await channel.messages.fetch(event.planningMessageId);
          const embed = buildSummaryFields(event)
            .setColor(EVENT_COLORS.denied)
            .setFooter({ text: `Event #${event.id} - Cancelled` })
            .addFields(
              {
                name: "Cancelled by",
                value: `<@${cancelledById}>`,
              },
              {
                name: "Host quota",
                value: "This event no longer counts toward the host's weekly limit.",
              },
            );
          await message.edit({ embeds: [embed], components: [] });
        }
      } catch (error) {
        loggers.bot.error(`Failed to update planning message for cancelled event ${event.id}`, error);
      }
    }
  }

  await prisma.plannedEvent.delete({ where: { id: eventId } });

  if (cancelledById !== event.hostId) {
    await notifyHost(
      guild,
      event,
      `❌ Your event **${event.title}** was cancelled by staff. It no longer counts toward your weekly event limit.`,
      {
        embedColor: EVENT_COLORS.denied,
        embedFooter: `Event #${event.id} - Cancelled`,
      },
    );
  }

  return { success: true };
}

/** @deprecated Use cancelPlannedEvent */
export async function cancelApprovedPlannedEvent(
  eventId: number,
  guild: Guild,
  cancelledById: string,
): Promise<{ success: boolean; error?: string }> {
  return cancelPlannedEvent(eventId, guild, cancelledById);
}

export async function countExportableEventsInRange(
  guildId: string,
  start: Date,
  end: Date,
): Promise<number> {
  return prisma.plannedEvent.count({
    where: {
      guildId,
      status: PlannedEventStatus.APPROVED,
      discordEventId: null,
      startTime: { gte: start, lt: end },
    },
  });
}

export async function resolveExportWeekRange(
  guildId: string,
  choice: ExportWeekChoice = "auto",
  now = new Date(),
): Promise<{ start: Date; end: Date; choice: Exclude<ExportWeekChoice, "auto">; label: string }> {
  if (choice !== "auto") {
    const range = getExportWeekRangeByChoice(choice, now);
    return {
      ...range,
      choice,
      label: formatEventWeekRangeLabel(range),
    };
  }

  const preferenceOrder = ["current", "previous", "next"] as const;
  for (const key of preferenceOrder) {
    const range = getExportWeekRangeByChoice(key, now);
    const count = await countExportableEventsInRange(guildId, range.start, range.end);
    if (count > 0) {
      return {
        ...range,
        choice: key,
        label: formatEventWeekRangeLabel(range),
      };
    }
  }

  const fallback = getExportWeekRangeByChoice("current", now);
  return {
    ...fallback,
    choice: "current",
    label: formatEventWeekRangeLabel(fallback),
  };
}

export async function getPendingEventsForWeek(
  guildId: string,
  start: Date,
  end: Date,
): Promise<PlannedEvent[]> {
  return prisma.plannedEvent.findMany({
    where: {
      guildId,
      status: PlannedEventStatus.PENDING,
      startTime: { gte: start, lt: end },
    },
    orderBy: { startTime: "asc" },
  });
}

export async function getPendingEventsForSchedulableWeek(
  guildId: string,
  now = new Date(),
): Promise<PlannedEvent[]> {
  const { start, end } = getSchedulableEventWeekRange(now);
  return getPendingEventsForWeek(guildId, start, end);
}

export function formatExportPendingWarning(
  pendingEvents: PlannedEvent[],
  guildId: string,
  planningChannelId: string | null | undefined,
): string {
  if (pendingEvents.length === 0) {
    return "";
  }

  const lines = pendingEvents.map((event) => {
    const label = `**${event.title}** (#${event.id})`;
    if (event.planningMessageId && planningChannelId) {
      const url = buildPlanningMessageUrl(
        guildId,
        planningChannelId,
        event.planningMessageId,
      );
      return `• [${event.title} (#${event.id})](${url})`;
    }
    return `• ${label}`;
  });

  return (
    `⚠️ **${pendingEvents.length} pending event(s)** in the approval queue will be **automatically denied** on export:\n` +
    `${lines.join("\n")}`
  );
}

export async function denyPendingEventsForWeek(
  guild: Guild,
  reviewerId: string,
  start: Date,
  end: Date,
  reason = "Not approved before the weekly schedule export.",
): Promise<PlannedEvent[]> {
  const pending = await getPendingEventsForWeek(guild.id, start, end);
  for (const event of pending) {
    await denyPlannedEvent(event.id, reviewerId, reason, guild);
  }
  return pending;
}

export async function denyPendingEventsForSchedulableWeek(
  guild: Guild,
  reviewerId: string,
  reason = "Not approved before the weekly schedule export.",
): Promise<PlannedEvent[]> {
  const { start, end } = getSchedulableEventWeekRange();
  return denyPendingEventsForWeek(guild, reviewerId, start, end, reason);
}

export async function getExportableEvents(
  guildId: string,
  range?: { start: Date; end: Date },
): Promise<PlannedEvent[]> {
  const { start, end } = range ?? (await resolveExportWeekRange(guildId));
  return prisma.plannedEvent.findMany({
    where: {
      guildId,
      status: PlannedEventStatus.APPROVED,
      discordEventId: null,
      startTime: { gte: start, lt: end },
    },
    orderBy: { startTime: "asc" },
  });
}

export { formatScheduleMessage } from "./eventScheduleFormatter.js";

export async function createDiscordScheduledEvent(
  guild: Guild,
  event: PlannedEvent,
  durationMinutes: number,
): Promise<{ success: boolean; discordEventId?: string; error?: string }> {
  try {
    const startMs = event.startTime.getTime();
    const endMs = startMs + durationMinutes * 60 * 1000;
    const hostName = await resolveEventMemberDisplayName(guild, event.hostId);
    const name = buildDiscordScheduledEventName(hostName, event.title);
    const description = await buildDiscordEventDescription(guild, event);

    // Always External (VRChat): Discord only auto-starts/ends External events and
    // requires/shows scheduledEndTime for them. Voice events stay SCHEDULED forever
    // until manually started and only end after the channel empties.
    const scheduled = await guild.scheduledEvents.create({
      name,
      scheduledStartTime: new Date(startMs),
      scheduledEndTime: new Date(endMs),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: DEFAULT_EXTERNAL_EVENT_LOCATION },
      description,
    });

    const updated = await prisma.plannedEvent.updateMany({
      where: { id: event.id, discordEventId: null },
      data: { discordEventId: scheduled.id },
    });

    if (updated.count === 0) {
      await scheduled.delete().catch(() => null);
      return {
        success: false,
        error: "Event was already exported or locked.",
      };
    }

    return { success: true, discordEventId: scheduled.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function updateDiscordScheduledEvent(
  guild: Guild,
  event: PlannedEvent,
): Promise<{ success: boolean; error?: string }> {
  if (!event.discordEventId) {
    return { success: false, error: "Event has no Discord scheduled event." };
  }

  try {
    const scheduled = await guild.scheduledEvents.fetch(event.discordEventId);
    const startMs = event.startTime.getTime();
    const endMs = startMs + event.durationMinutes * 60 * 1000;
    const hostName = await resolveEventMemberDisplayName(guild, event.hostId);
    const name = buildDiscordScheduledEventName(hostName, event.title);
    const description = await buildDiscordEventDescription(guild, event);

    await scheduled.edit({
      name,
      scheduledStartTime: new Date(startMs),
      scheduledEndTime: new Date(endMs),
      description,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: DEFAULT_EXTERNAL_EVENT_LOCATION },
      channel: null,
    } as unknown as Parameters<GuildScheduledEvent["edit"]>[0]);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export interface ExportApprovedEventsOptions {
  /** When true, skip posting to schedule channels and return templates for manual posting. */
  manualPost?: boolean;
  /** Event week to export. Defaults to auto-resolved week with exportable events. */
  weekRange?: { start: Date; end: Date };
}

export function buildManualExportTemplates(
  events: PlannedEvent[],
  exportSettings: ScheduleExportSettings,
  guildId: string,
): { onDuty: string; offDuty: string } {
  return {
    onDuty: formatOnDutyScheduleMessage(events, exportSettings, guildId),
    offDuty: formatOffDutyScheduleMessage(events, exportSettings, guildId),
  };
}

export async function exportApprovedEvents(
  guild: Guild,
  exporterUserId: string,
  options: ExportApprovedEventsOptions = {},
): Promise<{
  success: boolean;
  error?: string;
  schedulePosted?: boolean;
  manualPost?: boolean;
  deniedPendingCount?: number;
  manualTemplates?: { onDuty: string; offDuty: string };
  results?: { eventId: number; title: string; success: boolean; error?: string }[];
}> {
  if (exportLocks.has(guild.id)) {
    return {
      success: false,
      error: "An export is already in progress for this server. Please wait.",
    };
  }
  exportLocks.add(guild.id);

  try {
  const manualPost = options.manualPost ?? false;
  const weekRange =
    options.weekRange ?? (await resolveExportWeekRange(guild.id));
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId: guild.id },
  });

  const exportSettings = getScheduleExportSettings(settings);
  const onDutyChannelId = resolveOnDutyScheduleChannelId(settings);
  const offDutyChannelId = resolveOffDutyScheduleChannelId(settings);

  const events = await getExportableEvents(guild.id, weekRange);
  if (events.length === 0) {
    return {
      success: false,
      error: `No approved events to export for ${formatEventWeekRangeLabel(weekRange)}.`,
    };
  }

  const onDutyEvents = events.filter((e) => e.duty === EventDuty.ON_DUTY);
  const offDutyEvents = events.filter((e) => e.duty === EventDuty.OFF_DUTY);

  if (!manualPost) {
    if (onDutyEvents.length > 0 && !onDutyChannelId) {
      return {
        success: false,
        error:
          "On-duty schedule channel is not configured. Run `/settings events on-duty-schedule-channel`.",
      };
    }

    if (offDutyEvents.length > 0 && !offDutyChannelId) {
      return {
        success: false,
        error:
          "Off-duty schedule channel is not configured. Run `/settings events off-duty-schedule-channel`.",
      };
    }
  }

  const blocked = [];
  for (const event of events) {
    if (await jrHostMissingFullCoHost(guild, event.hostId, event.coHostId)) {
      blocked.push(event);
    }
  }

  if (blocked.length > 0) {
    const titles = blocked.map((e) => `• **${e.title}**`).join("\n");
    return {
      success: false,
      error:
        `Cannot export - the following Jr. Host events still need a full Host co-host:\n${titles}`,
    };
  }

  const results: {
    eventId: number;
    title: string;
    success: boolean;
    error?: string;
    discordEventId?: string;
  }[] = [];

  for (const event of events) {
    const result = await createDiscordScheduledEvent(
      guild,
      event,
      event.durationMinutes,
    );
    results.push({
      eventId: event.id,
      title: event.title,
      success: result.success,
      error: result.error,
      discordEventId: result.discordEventId,
    });
  }

  const allSucceeded = results.every((r) => r.success);
  if (!allSucceeded) {
    for (const result of results) {
      if (!result.success || !result.discordEventId) {
        continue;
      }
      try {
        const scheduled = await guild.scheduledEvents.fetch(result.discordEventId);
        await scheduled.delete();
      } catch (error) {
        loggers.bot.warn(
          `Failed to roll back Discord scheduled event ${result.discordEventId} during export`,
          error,
        );
      }
      await prisma.plannedEvent.updateMany({
        where: { id: result.eventId, discordEventId: result.discordEventId },
        data: { discordEventId: null },
      });
    }

    const failed = results.filter((r) => !r.success);
    const errorLines = failed
      .map((r) => `• **${r.title}**: ${r.error ?? "Unknown error"}`)
      .join("\n");
    return {
      success: false,
      error: `Failed to create Discord scheduled events:\n${errorLines}`,
      results,
    };
  }

  const deniedPending = await denyPendingEventsForWeek(
    guild,
    exporterUserId,
    weekRange.start,
    weekRange.end,
  );

  const manualTemplates = manualPost
    ? buildManualExportTemplates(events, exportSettings, guild.id)
    : undefined;

  if (!manualPost) {
    if (onDutyEvents.length > 0 && onDutyChannelId) {
      const onDutyChannel = await guild.channels.fetch(onDutyChannelId);
      if (!onDutyChannel?.isTextBased()) {
        return { success: false, error: "On-duty schedule channel is invalid." };
      }
      const onDutyText = formatOnDutyScheduleMessage(
        events,
        exportSettings,
        guild.id,
      );
      await onDutyChannel.send({ content: onDutyText });
    }

    if (offDutyEvents.length > 0 && offDutyChannelId) {
      const offDutyChannel = await guild.channels.fetch(offDutyChannelId);
      if (!offDutyChannel?.isTextBased()) {
        return { success: false, error: "Off-duty schedule channel is invalid." };
      }
      const offDutyText = formatOffDutyScheduleMessage(
        events,
        exportSettings,
        guild.id,
      );
      await offDutyChannel.send({ content: offDutyText });
    }
  }

  return {
    success: true,
    schedulePosted: !manualPost,
    manualPost,
    manualTemplates,
    deniedPendingCount: deniedPending.length,
    results,
  };
  } finally {
    exportLocks.delete(guild.id);
  }
}

export function buildExportConfirmPayload(
  guildId: string,
  manualPost = true,
  weekStartUnix?: number,
): MessageCreateOptions {
  const mode = manualPost ? "manual" : "channel";
  const weekSuffix =
    weekStartUnix != null ? `:${weekStartUnix}` : "";
  return {
    content: manualPost
      ? "Export approved events? You will receive copy-paste schedule templates and Discord scheduled events will be created."
      : "Export approved events for this week to the schedule channel and create Discord scheduled events?",
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`event:export:confirm:${guildId}:${mode}${weekSuffix}`)
          .setLabel("Confirm Export")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("event:export:cancel")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

