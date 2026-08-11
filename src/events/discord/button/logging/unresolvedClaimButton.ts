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
  UNRESOLVED_CLAIM_BUTTON_ID,
  unresolvedClaimModalCustomId,
} from "../../../../managers/logging/index.js";
import { loggers } from "../../../../utility/logger.js";

@Discord()
export class LoggingUnresolvedClaimButtonHandlers {
  /** No @Guard — showModal must run immediately. */
  @ButtonComponent({ id: UNRESOLVED_CLAIM_BUTTON_ID })
  async handleClaim(interaction: ButtonInteraction): Promise<void> {
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
        await interaction.reply({
          content: "❌ You don't have permission to claim logs.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(
          unresolvedClaimModalCustomId(
            interaction.message.channelId,
            interaction.message.id,
          ),
        )
        .setTitle("Claim log")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("Who did this / why")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1000),
          ),
        );

      await interaction.showModal(modal);
    } catch (error) {
      loggers.bot.error("Failed to show unresolved claim modal", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "❌ Failed to open claim form.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => undefined);
      }
    }
  }
}
