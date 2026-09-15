import { Discord, Slash, SlashGroup } from "discordx";
import { CommandInteraction, MessageFlags } from "discord.js";
import { replyWithProfileSettings } from "../../managers/profile/profileSettingsPanel.js";
import { loggers } from "../../utility/logger.js";
import { descriptionLocalizationsForKey, t } from "../../i18n/index.js";
import { resolveLocale } from "../../i18n/resolveLocale.js";

@Discord()
@SlashGroup("profile")
export class ProfileSettingsCommand {
  @Slash({
    name: "settings",
    description: "View and change your personal bot preferences",
    descriptionLocalizations: descriptionLocalizationsForKey("slash.profile.settings"),
  })
  async settings(interaction: CommandInteraction): Promise<void> {
    try {
      await replyWithProfileSettings(interaction);
    } catch (error) {
      loggers.bot.error("Error opening profile settings", error);
      const locale = await resolveLocale({
        userId: interaction.user.id,
        guildId: interaction.guildId,
      });
      await interaction.reply({
        content: t(locale, "profile.openFailed"),
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
