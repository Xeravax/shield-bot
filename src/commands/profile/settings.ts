import { Discord, Slash, SlashGroup } from "discordx";
import { CommandInteraction, MessageFlags } from "discord.js";
import { replyWithProfileSettings } from "../../managers/profile/profileSettingsPanel.js";
import { loggers } from "../../utility/logger.js";

@Discord()
@SlashGroup("profile")
export class ProfileSettingsCommand {
  @Slash({
    name: "settings",
    description: "View and change your personal bot preferences",
  })
  async settings(interaction: CommandInteraction): Promise<void> {
    try {
      await replyWithProfileSettings(interaction);
    } catch (error) {
      loggers.bot.error("Error opening profile settings", error);
      await interaction.reply({
        content: "❌ Failed to open profile settings. Please try again.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
