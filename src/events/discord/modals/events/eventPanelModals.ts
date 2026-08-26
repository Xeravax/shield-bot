import { MessageFlags, ModalSubmitInteraction } from "discord.js";
import { Discord, ModalComponent } from "discordx";
import { EventDuty, PlannedEventStatus } from "../../../../generated/prisma/client.js";
import { prisma } from "../../../../main.js";
import { parseEventTime } from "../../../../managers/events/eventTimeParser.js";
import { getCurrentEventWeekRange } from "../../../../managers/events/eventWeek.js";
import {
  getUserTimezone,
  hasStoredTimezone,
} from "../../../../utility/userPreferences.js";
import {
  canEditEventPanel,
  editDraftPanelMessage,
  editablePanelUpdateWhere,
  isEventPanelEditable,
  refreshDraftPanel,
} from "../../../../managers/events/eventPlanningManager.js";
import { loggers } from "../../../../utility/logger.js";
import { matchComponentId } from "../../../../utility/componentId.js";
import { resolveGuildMember } from "../../../../utility/guards.js";
import {
  isDraftPlaceholderTime,
  normalizeEventTitle,
} from "../../../../managers/events/eventDraftDefaults.js";
import {
  isDurationAllowedForDuty,
  parseDurationHoursInput,
} from "../../../../managers/events/eventType.js";

const EVENT_MODAL_TITLE_PATTERN = /^event-modal:title:(\d+)$/;
const EVENT_MODAL_TIME_PATTERN = /^event-modal:time:(\d+)$/;
const EVENT_MODAL_DURATION_PATTERN = /^event-modal:duration:(\d+)$/;

@Discord()
export class EventPanelModalHandlers {
  @ModalComponent({ id: EVENT_MODAL_TITLE_PATTERN })
  async handleTitleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_MODAL_TITLE_PATTERN);
    if (!match) {
      await interaction.reply({
        content: "❌ Invalid modal data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const eventId = parseInt(match[1], 10);
    const title = normalizeEventTitle(
      interaction.fields.getTextInputValue("title"),
    );
    if (!title) {
      await interaction.reply({
        content: "❌ Title cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || !isEventPanelEditable(event)) {
      await interaction.reply({
        content: "❌ Event draft not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await resolveGuildMember(interaction);
    if (!(await canEditEventPanel(interaction.user.id, member, event.hostId))) {
      await interaction.reply({
        content:
          "❌ Only the event host (or someone with `events.schedule.behalf`) can edit this panel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    try {
      const updated = await prisma.plannedEvent.updateMany({
        where: editablePanelUpdateWhere(eventId),
        data: { title },
      });
      if (updated.count === 0) {
        await interaction.followUp({
          content: "❌ This event is no longer editable.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { embed, components } = await refreshDraftPanel(eventId, interaction.guild);
      await editDraftPanelMessage(interaction, embed, components);
    } catch (error) {
      loggers.bot.error("Error updating event title", error);
      await interaction.followUp({
        content: "❌ Failed to update event title.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ModalComponent({ id: EVENT_MODAL_TIME_PATTERN })
  async handleTimeModal(interaction: ModalSubmitInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_MODAL_TIME_PATTERN);
    if (!match) {
      await interaction.reply({
        content: "❌ Invalid modal data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const eventId = parseInt(match[1], 10);

    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || !isEventPanelEditable(event)) {
      await interaction.reply({
        content: "❌ Event draft not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await resolveGuildMember(interaction);
    if (!(await canEditEventPanel(interaction.user.id, member, event.hostId))) {
      await interaction.reply({
        content:
          "❌ Only the event host (or someone with `events.schedule.behalf`) can edit this panel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const timeRaw = interaction.fields.getTextInputValue("time").trim();
    const isAbsoluteTime =
      /^\d{10,13}$/.test(timeRaw) || /<t:\d+(?::[tTdDfFR])?>/.test(timeRaw);
    if (!isAbsoluteTime && !(await hasStoredTimezone(event.hostId))) {
      await interaction.reply({
        content:
          "❌ The event host must set their timezone with `/timezone` (or `/profile settings`) before editing event times.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const timezone = isAbsoluteTime
      ? undefined
      : await getUserTimezone(event.hostId);
    const approvedExported =
      event.status === PlannedEventStatus.APPROVED && event.discordEventId != null;
    const startTime = parseEventTime(timeRaw, {
      timezone,
      enforceWeek: !event.forceOverride,
      forwardDate: !approvedExported,
      snapIntoWeek:
        !event.forceOverride && approvedExported
          ? getCurrentEventWeekRange()
          : undefined,
    });

    if (!startTime || isDraftPlaceholderTime(startTime)) {
      await interaction.reply({
        content: "❌ Invalid time.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!approvedExported && startTime.getTime() <= Date.now()) {
      await interaction.reply({
        content: "❌ Invalid or past time.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    try {
      const updated = await prisma.plannedEvent.updateMany({
        where: editablePanelUpdateWhere(eventId),
        data: { startTime },
      });
      if (updated.count === 0) {
        await interaction.followUp({
          content: "❌ This event is no longer editable.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { embed, components } = await refreshDraftPanel(eventId, interaction.guild);
      await editDraftPanelMessage(interaction, embed, components);
    } catch (error) {
      loggers.bot.error("Error updating event time", error);
      await interaction.followUp({
        content: "❌ Failed to update event time.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ModalComponent({ id: EVENT_MODAL_DURATION_PATTERN })
  async handleDurationModal(interaction: ModalSubmitInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_MODAL_DURATION_PATTERN);
    if (!match) {
      await interaction.reply({
        content: "❌ Invalid modal data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const eventId = parseInt(match[1], 10);

    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || !isEventPanelEditable(event)) {
      await interaction.reply({
        content: "❌ Event draft not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await resolveGuildMember(interaction);
    if (!(await canEditEventPanel(interaction.user.id, member, event.hostId))) {
      await interaction.reply({
        content:
          "❌ Only the event host (or someone with `events.schedule.behalf`) can edit this panel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (event.duty !== EventDuty.OFF_DUTY) {
      await interaction.reply({
        content: "❌ Custom duration is only available for off-duty events.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const durationMinutes = parseDurationHoursInput(
      interaction.fields.getTextInputValue("duration"),
    );
    if (
      durationMinutes === null ||
      !isDurationAllowedForDuty(durationMinutes, EventDuty.OFF_DUTY)
    ) {
      await interaction.reply({
        content:
          "❌ Enter a duration like `2`, `3.5h`, or `90m` (15 minutes to 7 days).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    try {
      const updated = await prisma.plannedEvent.updateMany({
        where: editablePanelUpdateWhere(eventId),
        data: { durationMinutes },
      });
      if (updated.count === 0) {
        await interaction.followUp({
          content: "❌ This event is no longer editable.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { embed, components } = await refreshDraftPanel(eventId, interaction.guild);
      await editDraftPanelMessage(interaction, embed, components);
    } catch (error) {
      loggers.bot.error("Error updating event duration", error);
      await interaction.followUp({
        content: "❌ Failed to update event duration.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
