import { MessageFlags, ModalSubmitInteraction } from "discord.js";
import { Discord, ModalComponent } from "discordx";
import { prisma } from "../../../../main.js";
import { parseEventTime } from "../../../../managers/events/eventTimeParser.js";
import { getUserTimezone } from "../../../../utility/userPreferences.js";
import { PlannedEventStatus } from "../../../../generated/prisma/client.js";
import { refreshDraftPanel, editDraftPanelMessage } from "../../../../managers/events/eventPlanningManager.js";
import { loggers } from "../../../../utility/logger.js";
import { matchComponentId } from "../../../../utility/componentId.js";

const EVENT_MODAL_TITLE_PATTERN = /^event-modal:title:(\d+)$/;
const EVENT_MODAL_TIME_PATTERN = /^event-modal:time:(\d+)$/;

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
    const title = interaction.fields.getTextInputValue("title").trim();
    if (!title) {
      await interaction.reply({
        content: "❌ Title cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== PlannedEventStatus.DRAFT) {
      await interaction.reply({
        content: "❌ Event draft not found.",
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

    try {
      const updated = await prisma.plannedEvent.updateMany({
        where: {
          id: eventId,
          hostId: interaction.user.id,
          status: PlannedEventStatus.DRAFT,
        },
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
    const timeRaw = interaction.fields.getTextInputValue("time").trim();
    const timezone = await getUserTimezone(interaction.user.id);
    const startTime = parseEventTime(timeRaw, { timezone });

    if (!startTime || startTime.getTime() <= Date.now()) {
      await interaction.reply({
        content: "❌ Invalid or past time.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== PlannedEventStatus.DRAFT) {
      await interaction.reply({
        content: "❌ Event draft not found.",
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

    try {
      const updated = await prisma.plannedEvent.updateMany({
        where: {
          id: eventId,
          hostId: interaction.user.id,
          status: PlannedEventStatus.DRAFT,
        },
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
}
