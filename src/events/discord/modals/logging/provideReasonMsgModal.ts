import {
  EmbedBuilder,
  MessageFlags,
  ModalSubmitInteraction,
} from "discord.js";
import { Discord, ModalComponent } from "discordx";
import { hasNode, resolveGuildMember } from "../../../../utility/permissionNodes.js";
import { matchComponentId } from "../../../../utility/componentId.js";
import { PROVIDE_REASON_MSG_MODAL_PREFIX } from "../../../../managers/logging/index.js";
import {
  buildResolvedReasonModLogV2Edit,
  upsertReasonField,
} from "../../../../managers/logging/reasonPrompt.js";
import { loggers } from "../../../../utility/logger.js";

const PROVIDE_REASON_MSG_MODAL_PATTERN = new RegExp(
  `^${PROVIDE_REASON_MSG_MODAL_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+):(\\d+)$`,
);

function messageMentionsUser(
  message: { content: string | null; flags: { has: (f: number) => boolean }; components: readonly unknown[] },
  userId: string,
): boolean {
  if ((message.content ?? "").includes(`<@${userId}>`)) {
    return true;
  }
  // Components V2: mention lives in TextDisplay content
  try {
    const json = JSON.stringify(message.components);
    return json.includes(`<@${userId}>`);
  } catch {
    return false;
  }
}

@Discord()
export class LoggingProvideReasonMsgModalHandlers {
  @ModalComponent({ id: PROVIDE_REASON_MSG_MODAL_PATTERN })
  async handleProvideReasonModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    try {
      if (!interaction.guildId || !interaction.guild) {
        await interaction.reply({
          content: "❌ This can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const match = matchComponentId(
        interaction.customId,
        PROVIDE_REASON_MSG_MODAL_PATTERN,
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
          content: "❌ A reason is required.",
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

      const member = await resolveGuildMember(interaction);
      const pinged = messageMentionsUser(message, interaction.user.id);
      const canClaim =
        !!member && (await hasNode(member, "mod.manage.claim"));
      if (!member || (!canClaim && !pinged)) {
        await interaction.editReply({
          content:
            "❌ You don't have permission to provide a reason for this log.",
        });
        return;
      }

      const v2Edit = buildResolvedReasonModLogV2Edit(message, reason);
      if (v2Edit) {
        await message.edit(v2Edit);
        await interaction.editReply({ content: "✅ Reason saved on this log." });
        return;
      }

      const existing = message.embeds[0];
      if (!existing) {
        await interaction.editReply({ content: "❌ Log embed missing." });
        return;
      }

      const embed = EmbedBuilder.from(existing);
      const fields = upsertReasonField(
        [...(embed.data.fields ?? [])].map((f) => ({
          name: f.name,
          value: f.value,
          inline: f.inline ?? undefined,
        })),
        reason,
      );
      embed.setFields(fields.slice(0, 25));

      await message.edit({
        content: null,
        embeds: [embed],
        components: [],
        allowedMentions: { parse: [] },
      });

      await interaction.editReply({ content: "✅ Reason saved on this log." });
    } catch (error) {
      loggers.bot.error("Error providing message log reason", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "❌ An error occurred while saving the reason.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => undefined);
      } else if (interaction.deferred) {
        await interaction
          .editReply({
            content: "❌ An error occurred while saving the reason.",
          })
          .catch(() => undefined);
      }
    }
  }
}
