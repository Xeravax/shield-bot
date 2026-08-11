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
  CLAIM_BUTTON_PREFIX,
  claimModalCustomId,
} from "../../../../managers/logging/index.js";
import { loggers } from "../../../../utility/logger.js";

const CLAIM_PATTERN = new RegExp(`^${CLAIM_BUTTON_PREFIX}(\\d+)$`);

@Discord()
export class LoggingClaimButtonHandlers {
  /** No @Guard — showModal must run immediately. */
  @ButtonComponent({ id: CLAIM_PATTERN })
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
          content: "❌ You don't have permission to claim cases.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const match = matchComponentId(interaction.customId, CLAIM_PATTERN);
      if (!match) {
        return;
      }
      const caseId = parseInt(match[1], 10);

      const modal = new ModalBuilder()
        .setCustomId(claimModalCustomId(caseId))
        .setTitle(`Claim case`)
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("reason")
              .setLabel("Claim reason")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1000),
          ),
        );

      await interaction.showModal(modal);
    } catch (error) {
      loggers.bot.error("Failed to show claim modal", error);
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
