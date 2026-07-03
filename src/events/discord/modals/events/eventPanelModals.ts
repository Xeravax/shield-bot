import { MessageFlags, ModalSubmitInteraction } from "discord.js";
import { Discord, ModalComponent } from "discordx";
import { prisma } from "../../../../main.js";
import { parseEventTime } from "../../../../managers/events/eventTimeParser.js";
import { getUserTimezone } from "../../../../utility/userPreferences.js";
import { PlannedEventStatus } from "../../../../generated/prisma/client.js";
import { refreshDraftPanel, editDraftPanelMessage } from "../../../../managers/events/eventPlanningManager.js";

@Discord()
export class EventPanelModalHandlers {
  @ModalComponent({ id: /^event-modal:title:(\d+)$/ })
  async handleTitleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const eventId = parseInt(interaction.customId.split(":")[2], 10);
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

    await prisma.plannedEvent.update({
      where: { id: eventId },
      data: { title },
    });

    await interaction.deferUpdate();
    const { embed, components } = await refreshDraftPanel(eventId, interaction.guild);
    await editDraftPanelMessage(interaction, embed, components);
  }

  @ModalComponent({ id: /^event-modal:time:(\d+)$/ })
  async handleTimeModal(interaction: ModalSubmitInteraction): Promise<void> {
    const eventId = parseInt(interaction.customId.split(":")[2], 10);
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

    await prisma.plannedEvent.update({
      where: { id: eventId },
      data: { startTime },
    });

    await interaction.deferUpdate();
    const { embed, components } = await refreshDraftPanel(eventId, interaction.guild);
    await editDraftPanelMessage(interaction, embed, components);
  }
}
