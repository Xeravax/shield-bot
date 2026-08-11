import { MessageFlags, ModalSubmitInteraction } from "discord.js";
import { Discord, ModalComponent } from "discordx";
import { modCaseManager } from "../../../../main.js";
import { hasNode, resolveGuildMember } from "../../../../utility/permissionNodes.js";
import { matchComponentId } from "../../../../utility/componentId.js";
import { CLAIM_MODAL_PREFIX } from "../../../../managers/logging/index.js";
import { loggers } from "../../../../utility/logger.js";

const CLAIM_MODAL_PATTERN = new RegExp(`^${CLAIM_MODAL_PREFIX}(\\d+)$`);

@Discord()
export class LoggingClaimModalHandlers {
  @ModalComponent({ id: CLAIM_MODAL_PATTERN })
  async handleClaimModal(interaction: ModalSubmitInteraction): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const member = await resolveGuildMember(interaction);
      if (!member || !(await hasNode(member, "mod.manage.claim"))) {
        await interaction.reply({
          content: "❌ You don't have permission to claim cases.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const match = matchComponentId(interaction.customId, CLAIM_MODAL_PATTERN);
      if (!match) {
        await interaction.reply({
          content: "❌ Invalid modal data.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const caseId = parseInt(match[1], 10);
      const reason = interaction.fields.getTextInputValue("reason").trim();
      if (!reason) {
        await interaction.reply({
          content: "❌ A claim reason is required.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await modCaseManager.claimCase(
        caseId,
        interaction.user.id,
        reason,
      );
      if (!result.success) {
        await interaction.editReply({ content: `❌ ${result.error}` });
        return;
      }
      await interaction.editReply({
        content: `✅ Claimed case #${result.modCase?.caseNumber}.`,
      });
    } catch (error) {
      loggers.bot.error("Error claiming case", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "❌ An error occurred while claiming the case.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => undefined);
      } else if (interaction.deferred) {
        await interaction
          .editReply({
            content: "❌ An error occurred while claiming the case.",
          })
          .catch(() => undefined);
      }
    }
  }
}
