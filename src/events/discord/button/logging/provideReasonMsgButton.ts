import {
  ActionRowBuilder,
  ButtonInteraction,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { ButtonComponent, Discord } from "discordx";
import { hasNode, resolveGuildMember } from "../../../../utility/permissionNodes.js";
import { matchComponentId } from "../../../../utility/componentId.js";
import {
  PROVIDE_REASON_MSG_BUTTON_ID,
  PROVIDE_REASON_PROMPT_BUTTON_PREFIX,
  provideReasonMsgModalCustomId,
  provideReasonPromptModalCustomId,
} from "../../../../managers/logging/index.js";
import { loggers } from "../../../../utility/logger.js";

const PROVIDE_REASON_PROMPT_BUTTON_PATTERN = new RegExp(
  `^${PROVIDE_REASON_PROMPT_BUTTON_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+):(\\d+)$`,
);

function messageMentionsUser(
  message: {
    content: string | null;
    components: readonly unknown[];
  },
  userId: string,
): boolean {
  if ((message.content ?? "").includes(`<@${userId}>`)) {
    return true;
  }
  try {
    return JSON.stringify(message.components).includes(`<@${userId}>`);
  } catch {
    return false;
  }
}

async function canProvideReason(
  interaction: ButtonInteraction,
): Promise<boolean> {
  let member: GuildMember | null =
    interaction.member instanceof GuildMember ? interaction.member : null;
  if (!member) {
    member = await resolveGuildMember(interaction);
  }
  if (member && (await hasNode(member, "mod.manage.claim"))) {
    return true;
  }
  return messageMentionsUser(interaction.message, interaction.user.id);
}

@Discord()
export class LoggingProvideReasonMsgButtonHandlers {
  /** Legacy in-channel V2 prompts (same message is edited). */
  @ButtonComponent({ id: PROVIDE_REASON_MSG_BUTTON_ID })
  async handleProvideReasonLegacy(
    interaction: ButtonInteraction,
  ): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!(await canProvideReason(interaction))) {
        await interaction.reply({
          content:
            "❌ You don't have permission to provide a reason for this log.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(
          provideReasonMsgModalCustomId(
            interaction.message.channelId,
            interaction.message.id,
          ),
        )
        .setTitle("Provide the reason")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("Reason for this action")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1000),
          ),
        );

      await interaction.showModal(modal);
    } catch (error) {
      loggers.bot.error("Failed to show provide-reason message modal", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "❌ Failed to open reason form.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => undefined);
      }
    }
  }

  /** Reasons-thread prompts: button targets the category log message. */
  @ButtonComponent({ id: PROVIDE_REASON_PROMPT_BUTTON_PATTERN })
  async handleProvideReasonPrompt(
    interaction: ButtonInteraction,
  ): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!(await canProvideReason(interaction))) {
        await interaction.reply({
          content:
            "❌ You don't have permission to provide a reason for this log.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const match = matchComponentId(
        interaction.customId,
        PROVIDE_REASON_PROMPT_BUTTON_PATTERN,
      );
      if (!match) {
        await interaction.reply({
          content: "❌ Invalid button data.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const logChannelId = match[1];
      const logMessageId = match[2];

      const modal = new ModalBuilder()
        .setCustomId(
          provideReasonPromptModalCustomId(
            logChannelId,
            logMessageId,
            interaction.message.channelId,
            interaction.message.id,
          ),
        )
        .setTitle("Provide the reason")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("Reason for this action")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1000),
          ),
        );

      await interaction.showModal(modal);
    } catch (error) {
      loggers.bot.error("Failed to show Reasons-thread provide-reason modal", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "❌ Failed to open reason form.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => undefined);
      }
    }
  }
}
