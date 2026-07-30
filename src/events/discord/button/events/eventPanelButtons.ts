import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { Discord, ButtonComponent } from "discordx";
import { EventDuty, PlannedEventStatus } from "../../../../generated/prisma/client.js";
import { prisma } from "../../../../main.js";
import {
  abortEventPanelEdit,
  canManageEventDraft,
  cancelAndDeleteFromPanel,
  cleanupStaleExportedEditSession,
  editDraftPanelMessage,
  editablePanelUpdateWhere,
  isEventLocked,
  isEventPanelEditable,
  refreshDraftPanel,
  runEventValidation,
  saveExportedEventChanges,
  submitEventForApproval,
} from "../../../../managers/events/eventPlanningManager.js";
import type { PlannedEvent } from "../../../../generated/prisma/client.js";
import {
  defaultDurationMinutes,
  nextDurationMinutes,
  nextEventType,
} from "../../../../managers/events/eventType.js";
import { isDraftPlaceholderTime } from "../../../../managers/events/eventDraftDefaults.js";
import { matchComponentId } from "../../../../utility/componentId.js";
import { formatNaturalEventTime } from "../../../../utility/estTime.js";
import { hasNode } from "../../../../utility/permissionNodes.js";
import { resolveGuildMember } from "../../../../utility/guards.js";
import { getUserTimezone } from "../../../../utility/userPreferences.js";

const EVENT_PANEL_TITLE_PATTERN = /^event-panel:title:(\d+)$/;
const EVENT_PANEL_TIME_PATTERN = /^event-panel:time:(\d+)$/;
const EVENT_PANEL_TOGGLE_DUTY_PATTERN = /^event-panel:toggle-duty:(\d+)$/;
const EVENT_PANEL_TOGGLE_TYPE_PATTERN = /^event-panel:toggle-type:(\d+)$/;
const EVENT_PANEL_TOGGLE_DURATION_PATTERN = /^event-panel:toggle-duration:(\d+)$/;
const EVENT_PANEL_TOGGLE_COHOST_OPEN_PATTERN = /^event-panel:toggle-cohost-open:(\d+)$/;
const EVENT_PANEL_TOGGLE_FORCE_PATTERN = /^event-panel:toggle-force:(\d+)$/;
const EVENT_PANEL_SUBMIT_PATTERN = /^event-panel:submit:(\d+)$/;
const EVENT_PANEL_SAVE_PATTERN = /^event-panel:save:(\d+)$/;
const EVENT_PANEL_CANCEL_PATTERN = /^event-panel:cancel:(\d+)$/;
const EVENT_PANEL_CANCEL_DELETE_PATTERN = /^event-panel:cancel-delete:(\d+)$/;

async function denyUnlessCanManageDraft(
  interaction: ButtonInteraction,
  event: PlannedEvent,
  action: "edit" | "submit" | "save" | "cancel" = "edit",
): Promise<boolean> {
  const member = await resolveGuildMember(interaction);
  if (await canManageEventDraft(interaction.user.id, member, event.hostId)) {
    return true;
  }
  // Event leads may act on an open exported-edit session without behalf.
  const exportedEditSession =
    isEventLocked(event) && event.editSnapshot != null;
  if (
    exportedEditSession &&
    member &&
    (await hasNode(member, "events.manage.approve"))
  ) {
    return true;
  }
  const messages = {
    edit: "❌ Only the event host (or someone with `events.schedule.behalf`) can edit this panel.",
    submit:
      "❌ Only the event host (or someone with `events.schedule.behalf`) can submit this event.",
    save:
      "❌ Only the event host (or someone with `events.schedule.behalf`) can save this event.",
    cancel:
      "❌ Only the event host (or someone with `events.schedule.behalf`) can cancel this draft.",
  };
  await interaction.reply({
    content: messages[action],
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

async function loadEditableEvent(eventId: number) {
  let event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
  if (!event) {
    return null;
  }
  if (
    event.status === PlannedEventStatus.APPROVED &&
    event.editSnapshot != null
  ) {
    event = await cleanupStaleExportedEditSession(event);
  }
  if (!isEventPanelEditable(event)) {
    return null;
  }
  return event;
}

@Discord()
export class EventPanelButtonHandlers {
  /** No @Guard before showModal — Discord 3s ack window. */
  @ButtonComponent({ id: EVENT_PANEL_TITLE_PATTERN })
  async handleEditTitle(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_PANEL_TITLE_PATTERN);
    if (!match) return;
    const eventId = parseInt(match[1], 10);
    const event = await loadEditableEvent(eventId);
    if (!event) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await denyUnlessCanManageDraft(interaction, event))) {
      return;
    }

    const input = new TextInputBuilder()
      .setCustomId("title")
      .setLabel("Event title")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(200)
      .setValue(event.title);

    const modal = new ModalBuilder()
      .setCustomId(`event-modal:title:${eventId}`)
      .setTitle("Edit event title")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: EVENT_PANEL_TIME_PATTERN })
  async handleEditTime(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_PANEL_TIME_PATTERN);
    if (!match) return;
    const eventId = parseInt(match[1], 10);
    const event = await loadEditableEvent(eventId);
    if (!event) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await denyUnlessCanManageDraft(interaction, event))) {
      return;
    }

    const timezone = await getUserTimezone(event.hostId);
    const naturalTime = isDraftPlaceholderTime(event.startTime)
      ? ""
      : formatNaturalEventTime(event.startTime, timezone);
    const input = new TextInputBuilder()
      .setCustomId("time")
      .setLabel("Time (in your timezone)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(200)
      .setPlaceholder("e.g. Saturday 8pm or next Friday at 7:30 PM")
      .setValue(naturalTime);

    const modal = new ModalBuilder()
      .setCustomId(`event-modal:time:${eventId}`)
      .setTitle("Edit event time")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: EVENT_PANEL_TOGGLE_DUTY_PATTERN })
  async handleToggleDuty(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_PANEL_TOGGLE_DUTY_PATTERN);
    if (!match) return;
    const eventId = parseInt(match[1], 10);
    const event = await loadEditableEvent(eventId);
    if (!event) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await denyUnlessCanManageDraft(interaction, event))) {
      return;
    }

    const newDuty =
      event.duty === EventDuty.ON_DUTY ? EventDuty.OFF_DUTY : EventDuty.ON_DUTY;

    await interaction.deferUpdate();
    const updated = await prisma.plannedEvent.updateMany({
      where: editablePanelUpdateWhere(eventId),
      data: {
        duty: newDuty,
        durationMinutes: defaultDurationMinutes(newDuty),
      },
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
  }

  @ButtonComponent({ id: EVENT_PANEL_TOGGLE_TYPE_PATTERN })
  async handleToggleType(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_PANEL_TOGGLE_TYPE_PATTERN);
    if (!match) return;
    const eventId = parseInt(match[1], 10);
    const event = await loadEditableEvent(eventId);
    if (!event) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await denyUnlessCanManageDraft(interaction, event))) {
      return;
    }

    await interaction.deferUpdate();
    const updated = await prisma.plannedEvent.updateMany({
      where: editablePanelUpdateWhere(eventId),
      data: { eventType: nextEventType(event.eventType) },
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
  }

  @ButtonComponent({ id: EVENT_PANEL_TOGGLE_DURATION_PATTERN })
  async handleToggleDuration(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_PANEL_TOGGLE_DURATION_PATTERN);
    if (!match) return;
    const eventId = parseInt(match[1], 10);
    const event = await loadEditableEvent(eventId);
    if (!event) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await denyUnlessCanManageDraft(interaction, event))) {
      return;
    }

    await interaction.deferUpdate();
    const updated = await prisma.plannedEvent.updateMany({
      where: editablePanelUpdateWhere(eventId),
      data: {
        durationMinutes: nextDurationMinutes(event.durationMinutes, event.duty),
      },
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
  }

  @ButtonComponent({ id: EVENT_PANEL_TOGGLE_COHOST_OPEN_PATTERN })
  async handleToggleCoHostOpen(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(
      interaction.customId,
      EVENT_PANEL_TOGGLE_COHOST_OPEN_PATTERN,
    );
    if (!match) return;
    const eventId = parseInt(match[1], 10);
    const event = await loadEditableEvent(eventId);
    if (!event) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await denyUnlessCanManageDraft(interaction, event))) {
      return;
    }

    const coHostOpen = !event.coHostOpen;
    await interaction.deferUpdate();
    const updated = await prisma.plannedEvent.updateMany({
      where: editablePanelUpdateWhere(eventId),
      data: {
        coHostOpen,
        ...(coHostOpen ? { coHostId: null } : {}),
      },
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
  }

  @ButtonComponent({ id: EVENT_PANEL_TOGGLE_FORCE_PATTERN })
  async handleToggleForce(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_PANEL_TOGGLE_FORCE_PATTERN);
    if (!match) return;
    const eventId = parseInt(match[1], 10);
    const event = await loadEditableEvent(eventId);
    if (!event) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await denyUnlessCanManageDraft(interaction, event))) {
      return;
    }

    const enabling = !event.forceOverride;
    if (enabling) {
      const member = await resolveGuildMember(interaction);
      if (!member || !(await hasNode(member, "events.schedule.force"))) {
        await interaction.reply({
          content: "❌ You need the `events.schedule.force` permission to enable force.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferUpdate();
    const updated = await prisma.plannedEvent.updateMany({
      where: editablePanelUpdateWhere(eventId),
      data: { forceOverride: enabling },
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
  }

  @ButtonComponent({ id: EVENT_PANEL_SUBMIT_PATTERN })
  async handleSubmit(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_PANEL_SUBMIT_PATTERN);
    if (!match) return;
    const eventId = parseInt(match[1], 10);
    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      await interaction.reply({
        content: "❌ Event not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await denyUnlessCanManageDraft(interaction, event, "submit"))) {
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (event.status !== PlannedEventStatus.DRAFT) {
      await interaction.reply({
        content: "❌ Only draft events can be submitted for approval.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { results } = await runEventValidation(event, interaction.guild);
    if (results.some((r) => r.severity === "fail")) {
      await interaction.reply({
        content: "❌ Blocking validation failures must be resolved before submitting.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    const result = await submitEventForApproval(eventId, interaction.guild);
    if (!result.success) {
      await interaction.followUp({
        content: `❌ ${result.error}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.editReply({
      content: "✅ Event submitted for approval! Check the planning channel.",
      embeds: [],
      components: [],
    });
  }

  @ButtonComponent({ id: EVENT_PANEL_SAVE_PATTERN })
  async handleSave(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_PANEL_SAVE_PATTERN);
    if (!match) return;
    const eventId = parseInt(match[1], 10);
    const event = await loadEditableEvent(eventId);
    if (!event) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await denyUnlessCanManageDraft(interaction, event, "save"))) {
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();
    const result = await saveExportedEventChanges(eventId, interaction.guild);
    if (!result.success) {
      await interaction.followUp({
        content: `❌ ${result.error}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.editReply({
      content: "✅ Exported event updated (Discord scheduled event synced).",
      embeds: [],
      components: [],
    });
  }

  @ButtonComponent({ id: EVENT_PANEL_CANCEL_PATTERN })
  async handleCancel(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_PANEL_CANCEL_PATTERN);
    if (!match) return;
    const eventId = parseInt(match[1], 10);
    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      await interaction.reply({
        content: "❌ Event not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await denyUnlessCanManageDraft(interaction, event, "cancel"))) {
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = await abortEventPanelEdit(eventId, interaction.guild);
    if (!result.success) {
      await interaction.reply({
        content: `❌ ${result.error}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.update({
      content: `❌ ${result.message ?? "Cancelled."}`,
      embeds: [],
      components: [],
    });
  }

  @ButtonComponent({ id: EVENT_PANEL_CANCEL_DELETE_PATTERN })
  async handleCancelDelete(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(
      interaction.customId,
      EVENT_PANEL_CANCEL_DELETE_PATTERN,
    );
    if (!match) return;
    const eventId = parseInt(match[1], 10);
    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      await interaction.reply({
        content: "❌ Event not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await denyUnlessCanManageDraft(interaction, event, "cancel"))) {
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = await cancelAndDeleteFromPanel(
      eventId,
      interaction.guild,
      interaction.user.id,
    );
    if (!result.success) {
      await interaction.reply({
        content: `❌ ${result.error}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.update({
      content: `❌ ${result.message ?? "Cancelled and deleted."}`,
      embeds: [],
      components: [],
    });
  }
}
