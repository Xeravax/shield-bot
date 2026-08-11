import {
  EmbedBuilder,
  MessageFlags,
  ModalSubmitInteraction,
} from "discord.js";
import { Discord, ModalComponent } from "discordx";
import { auditLogManager } from "../../../../main.js";
import { hasNode, resolveGuildMember } from "../../../../utility/permissionNodes.js";
import { matchComponentId } from "../../../../utility/componentId.js";
import { UNRESOLVED_CLAIM_MODAL_PREFIX } from "../../../../managers/logging/index.js";
import { loggers } from "../../../../utility/logger.js";

const UNRESOLVED_CLAIM_MODAL_PATTERN = new RegExp(
  `^${UNRESOLVED_CLAIM_MODAL_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+):(\\d+)$`,
);

@Discord()
export class LoggingUnresolvedClaimModalHandlers {
  @ModalComponent({ id: UNRESOLVED_CLAIM_MODAL_PATTERN })
  async handleClaimModal(interaction: ModalSubmitInteraction): Promise<void> {
    try {
      if (!interaction.guildId || !interaction.guild) {
        await interaction.reply({
          content: "❌ This can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const member = await resolveGuildMember(interaction);
      if (!member || !(await hasNode(member, "mod.manage.claim"))) {
        await interaction.editReply({
          content: "❌ You don't have permission to claim logs.",
        });
        return;
      }

      const match = matchComponentId(
        interaction.customId,
        UNRESOLVED_CLAIM_MODAL_PATTERN,
      );
      if (!match) {
        await interaction.editReply({ content: "❌ Invalid modal data." });
        return;
      }

      const channelId = match[1];
      const messageId = match[2];
      const reason = interaction.fields.getTextInputValue("reason").trim();
      if (!reason) {
        await interaction.editReply({
          content: "❌ A claim reason is required.",
        });
        return;
      }

      const channel = await interaction.guild.channels
        .fetch(channelId)
        .catch(() => null);
      if (!channel?.isTextBased()) {
        await interaction.editReply({ content: "❌ Log channel not found." });
        return;
      }

      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        await interaction.editReply({ content: "❌ Log message not found." });
        return;
      }

      const existing = message.embeds[0];
      if (!existing) {
        await interaction.editReply({ content: "❌ Log embed missing." });
        return;
      }

      const embed = EmbedBuilder.from(existing);
      const fields = [...(embed.data.fields ?? [])];
      if (fields.some((f) => f.name === "Claim reason")) {
        await interaction.editReply({
          content: "ℹ️ This log has already been claimed.",
        });
        return;
      }

      const claimedValue = auditLogManager.formatUser(
        interaction.user.id,
        interaction.user.tag,
      );
      const executorIdx = fields.findIndex((f) => f.name === "Executor");
      if (executorIdx >= 0) {
        fields[executorIdx] = {
          name: "Executor",
          value: claimedValue,
          inline: true,
        };
      } else {
        fields.push({
          name: "Executor",
          value: claimedValue,
          inline: true,
        });
      }

      fields.push({
        name: "Claim reason",
        value: reason.slice(0, 1024),
        inline: false,
      });

      embed.setFields(fields.slice(0, 25));
      await message.edit({ embeds: [embed], components: [] });

      await interaction.editReply({ content: "✅ Claimed this log." });
    } catch (error) {
      loggers.bot.error("Error claiming unresolved log", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "❌ An error occurred while claiming the log.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => undefined);
      } else if (interaction.deferred) {
        await interaction
          .editReply({
            content: "❌ An error occurred while claiming the log.",
          })
          .catch(() => undefined);
      }
    }
  }
}
