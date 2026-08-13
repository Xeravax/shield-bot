import { ButtonInteraction, MessageFlags } from "discord.js";
import { ButtonComponent, Discord } from "discordx";
import { matchComponentId } from "../../../../utility/componentId.js";
import { loggers } from "../../../../utility/logger.js";
import {
  OPT_ROLE_BUTTON_PATTERN,
  toggleOptRole,
} from "../../../../managers/optRoles/optRolePanel.js";

@Discord()
export class OptRoleButtonHandlers {
  @ButtonComponent({ id: OPT_ROLE_BUTTON_PATTERN })
  async handleToggle(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, OPT_ROLE_BUTTON_PATTERN);
    if (!match) {
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ Opt-in roles can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);

      const result = await toggleOptRole(interaction.guild, member, match[1]);
      if (!result.ok) {
        await interaction.editReply({ content: result.message });
        return;
      }

      await interaction.editReply({
        content: result.added
          ? `✅ Added **${result.roleName}**. Click the button again to remove it.`
          : `✅ Removed **${result.roleName}**. Click the button again to get it back.`,
      });
    } catch (error) {
      loggers.bot.error("opt-role button toggle failed", error);
      await interaction.editReply({
        content: "❌ Failed to update your roles. Please try again in a moment.",
      });
    }
  }
}
