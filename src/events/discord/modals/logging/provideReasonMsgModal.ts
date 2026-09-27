import {
  EmbedBuilder,
  MessageFlags,
  ModalSubmitInteraction,
  type Message,
} from "discord.js";
import { Discord, ModalComponent } from "discordx";
import { hasNode, resolveGuildMember } from "../../../../utility/permissionNodes.js";
import { matchComponentId } from "../../../../utility/componentId.js";
import {
  PROVIDE_REASON_MSG_MODAL_PREFIX,
  PROVIDE_REASON_PROMPT_MODAL_PREFIX,
} from "../../../../managers/logging/index.js";
import {
  buildResolvedReasonModLogV2Edit,
  upsertReasonField,
} from "../../../../managers/logging/reasonPrompt.js";
import { loggers } from "../../../../utility/logger.js";

const PROVIDE_REASON_MSG_MODAL_PATTERN = new RegExp(
  `^${PROVIDE_REASON_MSG_MODAL_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+):(\\d+)$`,
);

const PROVIDE_REASON_PROMPT_MODAL_PATTERN = new RegExp(
  `^${PROVIDE_REASON_PROMPT_MODAL_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+):(\\d+):(\\d+):(\\d+)$`,
);

function messageMentionsUser(
  message: {
    content: string | null;
    flags: { has: (f: number) => boolean };
    components: readonly unknown[];
  },
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

async function fetchTextMessage(
  interaction: ModalSubmitInteraction,
  channelId: string,
  messageId: string,
): Promise<Message | null> {
  if (!interaction.guild) {
    return null;
  }
  const channel = await interaction.guild.channels
    .fetch(channelId)
    .catch(() => null);
  if (!channel?.isTextBased()) {
    return null;
  }
  return channel.messages.fetch(messageId).catch(() => null);
}

async function applyReasonToEmbedLog(
  message: Message,
  reason: string,
  options?: { clearComponents?: boolean },
): Promise<boolean> {
  const existing = message.embeds[0];
  if (!existing) {
    return false;
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
    ...(options?.clearComponents ? { components: [] as const } : {}),
    allowedMentions: { parse: [] },
  });
  return true;
}

@Discord()
export class LoggingProvideReasonMsgModalHandlers {
  /** Legacy: edit the same in-channel prompt / log message. */
  @ModalComponent({ id: PROVIDE_REASON_MSG_MODAL_PATTERN })
  async handleProvideReasonModalLegacy(
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

      const message = await fetchTextMessage(interaction, channelId, messageId);
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

      if (!(await applyReasonToEmbedLog(message, reason, { clearComponents: true }))) {
        await interaction.editReply({ content: "❌ Log embed missing." });
        return;
      }

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

  /** Reasons thread: update category log embed + resolve the prompt. */
  @ModalComponent({ id: PROVIDE_REASON_PROMPT_MODAL_PATTERN })
  async handleProvideReasonPromptModal(
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
        PROVIDE_REASON_PROMPT_MODAL_PATTERN,
      );
      if (!match) {
        await interaction.editReply({ content: "❌ Invalid modal data." });
        return;
      }

      const logChannelId = match[1];
      const logMessageId = match[2];
      const promptChannelId = match[3];
      const promptMessageId = match[4];
      const reason = interaction.fields.getTextInputValue("reason").trim();
      if (!reason) {
        await interaction.editReply({
          content: "❌ A reason is required.",
        });
        return;
      }

      const promptMessage = await fetchTextMessage(
        interaction,
        promptChannelId,
        promptMessageId,
      );
      if (!promptMessage) {
        await interaction.editReply({ content: "❌ Reason prompt not found." });
        return;
      }

      const member = await resolveGuildMember(interaction);
      const pinged = messageMentionsUser(promptMessage, interaction.user.id);
      const canClaim =
        !!member && (await hasNode(member, "mod.manage.claim"));
      if (!member || (!canClaim && !pinged)) {
        await interaction.editReply({
          content:
            "❌ You don't have permission to provide a reason for this log.",
        });
        return;
      }

      const logMessage = await fetchTextMessage(
        interaction,
        logChannelId,
        logMessageId,
      );
      if (!logMessage) {
        await interaction.editReply({ content: "❌ Log message not found." });
        return;
      }

      if (!(await applyReasonToEmbedLog(logMessage, reason))) {
        await interaction.editReply({ content: "❌ Log embed missing." });
        return;
      }

      const promptEdit = buildResolvedReasonModLogV2Edit(promptMessage, reason);
      if (promptEdit) {
        await promptMessage.edit(promptEdit);
      } else {
        await promptMessage.edit({
          content: null,
          components: [],
          allowedMentions: { parse: [] },
        });
      }

      await interaction.editReply({
        content: "✅ Reason saved on the log and this prompt.",
      });
    } catch (error) {
      loggers.bot.error("Error providing Reasons-thread log reason", error);
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
