import { MessageFlags, UserSelectMenuInteraction } from "discord.js";
import { Discord, SelectMenuComponent } from "discordx";
import { prisma } from "../../../../main.js";
import { PlannedEventStatus } from "../../../../generated/prisma/client.js";
import { refreshDraftPanel, editDraftPanelMessage } from "../../../../managers/events/eventPlanningManager.js";
import { matchComponentId } from "../../../../utility/componentId.js";

const EVENT_PANEL_HOST_PATTERN = /^event-panel-select:host:(\d+)$/;
const EVENT_PANEL_COHOST_PATTERN = /^event-panel-select:cohost:(\d+)$/;

@Discord()
export class EventPanelSelectHandlers {
  @SelectMenuComponent({ id: EVENT_PANEL_HOST_PATTERN })
  async handleHostSelect(interaction: UserSelectMenuInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_PANEL_HOST_PATTERN);
    if (!match) return;

    const eventId = parseInt(match[1], 10);
    const hostId = interaction.values[0];
    if (!hostId) {
      await interaction.reply({
        content: "❌ No host selected.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (hostId !== interaction.user.id) {
      await interaction.reply({
        content: "❌ You cannot transfer event ownership from the panel.",
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

  @SelectMenuComponent({ id: EVENT_PANEL_COHOST_PATTERN })
  async handleCoHostSelect(interaction: UserSelectMenuInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_PANEL_COHOST_PATTERN);
    if (!match) return;

    const eventId = parseInt(match[1], 10);
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
