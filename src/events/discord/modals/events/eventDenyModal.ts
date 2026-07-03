import {
  GuildMember,
  MessageFlags,
  ModalSubmitInteraction,
} from "discord.js";
import { Discord, ModalComponent } from "discordx";
import { denyPlannedEvent } from "../../../../managers/events/eventPlanningManager.js";
import { hasNode } from "../../../../utility/permissionNodes.js";
import { loggers } from "../../../../utility/logger.js";

@Discord()
export class EventDenyModalHandlers {
  @ModalComponent({ id: /^event-modal:deny:(\d+)$/ })
  async handleDenyModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = interaction.member as GuildMember | null;
    if (!member || !(await hasNode(member, "events.manage.approve"))) {
      await interaction.reply({
        content: "❌ You don't have permission to deny events.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const eventId = parseInt(interaction.customId.split(":")[2], 10);
    const reason = interaction.fields.getTextInputValue("reason").trim();
    if (!reason) {
      await interaction.reply({
        content: "❌ A denial reason is required.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await denyPlannedEvent(
        eventId,
        interaction.user.id,
        reason,
        interaction.guild,
      );
      if (!result.success) {
        await interaction.editReply({ content: `❌ ${result.error}` });
        return;
      }

      await interaction.editReply({ content: "✅ Event denied." });
    } catch (error) {
      loggers.bot.error("Error denying event", error);
      await interaction.editReply({
        content: "❌ An error occurred while denying the event.",
      });
    }
  }
}
