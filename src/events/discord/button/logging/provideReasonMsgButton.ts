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
import {
  PROVIDE_REASON_MSG_BUTTON_ID,
  provideReasonMsgModalCustomId,
} from "../../../../managers/logging/index.js";
import { loggers } from "../../../../utility/logger.js";

@Discord()
export class LoggingProvideReasonMsgButtonHandlers {
  /** No @Guard — showModal must run immediately. */
  @ButtonComponent({ id: PROVIDE_REASON_MSG_BUTTON_ID })
  async handleProvideReason(interaction: ButtonInteraction): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let member: GuildMember | null =
        interaction.member instanceof GuildMember ? interaction.member : null;
      if (!member) {
        member = await resolveGuildMember(interaction);
      }
      if (!member || !(await hasNode(member, "mod.manage.claim"))) {
        // Also allow if this user was pinged on the log (classic content or V2 TextDisplay)
        const content = interaction.message.content ?? "";
        let pinged = content.includes(`<@${interaction.user.id}>`);
        if (!pinged) {
          try {
            pinged = JSON.stringify(interaction.message.components).includes(
              `<@${interaction.user.id}>`,
            );
          } catch {
            pinged = false;
          }
        }
        if (!pinged) {
          await interaction.reply({
            content: "❌ You don't have permission to provide a reason for this log.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
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
}
