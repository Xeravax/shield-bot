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
  refreshDraftPanel,
  runEventValidation,
  submitEventForApproval,
  editDraftPanelMessage,
} from "../../../../managers/events/eventPlanningManager.js";
import {
  defaultDurationMinutes,
  nextDurationMinutes,
  nextEventType,
} from "../../../../managers/events/eventType.js";
import { isDraftPlaceholderTime } from "../../../../managers/events/eventDraftDefaults.js";
import { matchComponentId } from "../../../../utility/componentId.js";
import { hasNode } from "../../../../utility/permissionNodes.js";
import { resolveGuildMember } from "../../../../utility/guards.js";

const EVENT_PANEL_TITLE_PATTERN = /^event-panel:title:(\d+)$/;
const EVENT_PANEL_TIME_PATTERN = /^event-panel:time:(\d+)$/;
const EVENT_PANEL_TOGGLE_DUTY_PATTERN = /^event-panel:toggle-duty:(\d+)$/;
const EVENT_PANEL_TOGGLE_TYPE_PATTERN = /^event-panel:toggle-type:(\d+)$/;
const EVENT_PANEL_TOGGLE_DURATION_PATTERN = /^event-panel:toggle-duration:(\d+)$/;
const EVENT_PANEL_TOGGLE_COHOST_OPEN_PATTERN = /^event-panel:toggle-cohost-open:(\d+)$/;
const EVENT_PANEL_TOGGLE_FORCE_PATTERN = /^event-panel:toggle-force:(\d+)$/;
const EVENT_PANEL_SUBMIT_PATTERN = /^event-panel:submit:(\d+)$/;
const EVENT_PANEL_CANCEL_PATTERN = /^event-panel:cancel:(\d+)$/;

@Discord()
export class EventPanelButtonHandlers {
  /** No @Guard before showModal — Discord 3s ack window. */
  @ButtonComponent({ id: EVENT_PANEL_TITLE_PATTERN })
  async handleEditTitle(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_PANEL_TITLE_PATTERN);
    if (!match) return;
    const eventId = parseInt(match[1], 10);
    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== PlannedEventStatus.DRAFT) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== event.hostId) {
      await interaction.reply({
        content: "❌ Only the event host can edit this panel.",
        flags: MessageFlags.Ephemeral,
      });
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
    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== PlannedEventStatus.DRAFT) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== event.hostId) {
      await interaction.reply({
        content: "❌ Only the event host can edit this panel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const unix = Math.floor(event.startTime.getTime() / 1000);
    const input = new TextInputBuilder()
      .setCustomId("time")
      .setLabel("Time (natural language or Unix)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(200)
      .setPlaceholder("e.g. Saturday 8pm or 1730000000")
      .setValue(isDraftPlaceholderTime(event.startTime) ? "" : String(unix));

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
    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== PlannedEventStatus.DRAFT) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== event.hostId) {
      await interaction.reply({
        content: "❌ Only the event host can edit this panel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const newDuty =
      event.duty === EventDuty.ON_DUTY ? EventDuty.OFF_DUTY : EventDuty.ON_DUTY;

    await interaction.deferUpdate();
    const updated = await prisma.plannedEvent.updateMany({
      where: {
        id: eventId,
        hostId: interaction.user.id,
        status: PlannedEventStatus.DRAFT,
      },
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
    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== PlannedEventStatus.DRAFT) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== event.hostId) {
      await interaction.reply({
        content: "❌ Only the event host can edit this panel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();
    const updated = await prisma.plannedEvent.updateMany({
      where: {
        id: eventId,
        hostId: interaction.user.id,
        status: PlannedEventStatus.DRAFT,
      },
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
    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== PlannedEventStatus.DRAFT) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== event.hostId) {
      await interaction.reply({
        content: "❌ Only the event host can edit this panel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();
    const updated = await prisma.plannedEvent.updateMany({
      where: {
        id: eventId,
        hostId: interaction.user.id,
        status: PlannedEventStatus.DRAFT,
      },
      data: { durationMinutes: nextDurationMinutes(event.durationMinutes, event.duty) },
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
    const match = matchComponentId(interaction.customId, EVENT_PANEL_TOGGLE_COHOST_OPEN_PATTERN);
    if (!match) return;
    const eventId = parseInt(match[1], 10);
    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== PlannedEventStatus.DRAFT) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== event.hostId) {
      await interaction.reply({
        content: "❌ Only the event host can edit this panel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const coHostOpen = !event.coHostOpen;
    await interaction.deferUpdate();
    const updated = await prisma.plannedEvent.updateMany({
      where: {
        id: eventId,
        hostId: interaction.user.id,
        status: PlannedEventStatus.DRAFT,
      },
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
    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== PlannedEventStatus.DRAFT) {
      await interaction.reply({
        content: "❌ Event not found or not editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== event.hostId) {
      await interaction.reply({
        content: "❌ Only the event host can edit this panel.",
        flags: MessageFlags.Ephemeral,
      });
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
      where: {
        id: eventId,
        hostId: interaction.user.id,
        status: PlannedEventStatus.DRAFT,
      },
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

    if (interaction.user.id !== event.hostId) {
      await interaction.reply({
        content: "❌ Only the event host can submit this event.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
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

    if (interaction.user.id !== event.hostId) {
      await interaction.reply({
        content: "❌ Only the event host can cancel this draft.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (event.status !== PlannedEventStatus.DRAFT) {
      await interaction.reply({
        content: "❌ Only draft events can be cancelled from this panel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const deleted = await prisma.plannedEvent.deleteMany({
      where: {
        id: eventId,
        hostId: interaction.user.id,
        status: PlannedEventStatus.DRAFT,
      },
    });
    if (deleted.count === 0) {
      await interaction.reply({
        content: "❌ This event is no longer editable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.update({
      content: "❌ Draft cancelled and deleted.",
      embeds: [],
      components: [],
    });
  }
}
