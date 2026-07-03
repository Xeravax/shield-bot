import { MessageFlags, UserSelectMenuInteraction } from "discord.js";
import { Discord, SelectMenuComponent } from "discordx";
import { prisma } from "../../../../main.js";
import { PlannedEventStatus } from "../../../../generated/prisma/client.js";
import { refreshDraftPanel, editDraftPanelMessage } from "../../../../managers/events/eventPlanningManager.js";

@Discord()
export class EventPanelSelectHandlers {
  @SelectMenuComponent({ id: /^event-panel-select:host:(\d+)$/ })
  async handleHostSelect(interaction: UserSelectMenuInteraction): Promise<void> {
    const eventId = parseInt(interaction.customId.split(":")[2], 10);
    const hostId = interaction.values[0];
    if (!hostId) {
      await interaction.reply({
        content: "❌ No host selected.",
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
    await prisma.plannedEvent.update({
      where: { id: eventId },
      data: { hostId },
    });
    const { embed, components } = await refreshDraftPanel(eventId, interaction.guild);
    await editDraftPanelMessage(interaction, embed, components);
  }

  @SelectMenuComponent({ id: /^event-panel-select:cohost:(\d+)$/ })
  async handleCoHostSelect(interaction: UserSelectMenuInteraction): Promise<void> {
    const eventId = parseInt(interaction.customId.split(":")[2], 10);
    const coHostId = interaction.values[0] ?? null;

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
    await prisma.plannedEvent.update({
      where: { id: eventId },
      data: { coHostId },
    });
    const { embed, components } = await refreshDraftPanel(eventId, interaction.guild);
    await editDraftPanelMessage(interaction, embed, components);
  }
}
