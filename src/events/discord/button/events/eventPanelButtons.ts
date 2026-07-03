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

@Discord()
export class EventPanelButtonHandlers {
  /** No @Guard before showModal — Discord 3s ack window. */
  @ButtonComponent({ id: /^event-panel:title:(\d+)$/ })
  async handleEditTitle(interaction: ButtonInteraction): Promise<void> {
    const eventId = parseInt(interaction.customId.split(":")[2], 10);
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

  @ButtonComponent({ id: /^event-panel:time:(\d+)$/ })
  async handleEditTime(interaction: ButtonInteraction): Promise<void> {
    const eventId = parseInt(interaction.customId.split(":")[2], 10);
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

  @ButtonComponent({ id: /^event-panel:toggle-duty:(\d+)$/ })
  async handleToggleDuty(interaction: ButtonInteraction): Promise<void> {
    const eventId = parseInt(interaction.customId.split(":")[2], 10);
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
    await prisma.plannedEvent.update({
      where: { id: eventId },
      data: {
        duty: newDuty,
        durationMinutes: defaultDurationMinutes(newDuty),
      },
    });

    const { embed, components } = await refreshDraftPanel(eventId, interaction.guild);
    await editDraftPanelMessage(interaction, embed, components);
  }

  @ButtonComponent({ id: /^event-panel:toggle-type:(\d+)$/ })
  async handleToggleType(interaction: ButtonInteraction): Promise<void> {
    const eventId = parseInt(interaction.customId.split(":")[2], 10);
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
    await prisma.plannedEvent.update({
      where: { id: eventId },
      data: { eventType: nextEventType(event.eventType) },
    });

    const { embed, components } = await refreshDraftPanel(eventId, interaction.guild);
    await editDraftPanelMessage(interaction, embed, components);
  }

  @ButtonComponent({ id: /^event-panel:toggle-duration:(\d+)$/ })
  async handleToggleDuration(interaction: ButtonInteraction): Promise<void> {
    const eventId = parseInt(interaction.customId.split(":")[2], 10);
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
    await prisma.plannedEvent.update({
      where: { id: eventId },
      data: { durationMinutes: nextDurationMinutes(event.durationMinutes, event.duty) },
    });

    const { embed, components } = await refreshDraftPanel(eventId, interaction.guild);
    await editDraftPanelMessage(interaction, embed, components);
  }

  @ButtonComponent({ id: /^event-panel:toggle-cohost-open:(\d+)$/ })
  async handleToggleCoHostOpen(interaction: ButtonInteraction): Promise<void> {
    const eventId = parseInt(interaction.customId.split(":")[2], 10);
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
    await prisma.plannedEvent.update({
      where: { id: eventId },
      data: {
        coHostOpen,
        ...(coHostOpen ? { coHostId: null } : {}),
      },
    });

    const { embed, components } = await refreshDraftPanel(eventId, interaction.guild);
    await editDraftPanelMessage(interaction, embed, components);
  }

  @ButtonComponent({ id: /^event-panel:submit:(\d+)$/ })
  async handleSubmit(interaction: ButtonInteraction): Promise<void> {
    const eventId = parseInt(interaction.customId.split(":")[2], 10);
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

  @ButtonComponent({ id: /^event-panel:cancel:(\d+)$/ })
  async handleCancel(interaction: ButtonInteraction): Promise<void> {
    const eventId = parseInt(interaction.customId.split(":")[2], 10);
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

    await prisma.plannedEvent.delete({ where: { id: eventId } });

    await interaction.update({
      content: "❌ Draft cancelled and deleted.",
      embeds: [],
      components: [],
    });
  }
}
