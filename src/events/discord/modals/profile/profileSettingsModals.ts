import { MessageFlags, ModalSubmitInteraction } from "discord.js";
import { Discord, ModalComponent } from "discordx";
import {
  editProfileSettingsMessage,
  isProfileSettingsOwner,
} from "../../../../managers/profile/profileSettingsPanel.js";
import {
  isValidTimezone,
  updateUserPreferences,
} from "../../../../utility/userPreferences.js";
import { loggers } from "../../../../utility/logger.js";

@Discord()
export class ProfileSettingsModalHandlers {
  @ModalComponent({ id: /^profile-settings-modal:timezone:(\d+)$/ })
  async handleTimezoneModal(interaction: ModalSubmitInteraction): Promise<void> {
    const discordId = interaction.customId.split(":")[2];
    if (!isProfileSettingsOwner(interaction, discordId)) {
      await interaction.reply({
        content: "❌ These settings are not yours.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const timezone = interaction.fields.getTextInputValue("timezone").trim();
    if (!isValidTimezone(timezone)) {
      await interaction.reply({
        content:
          "❌ Invalid timezone. Use an IANA name like `America/New_York` or `Europe/Amsterdam`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await updateUserPreferences(discordId, { timezone });
      await interaction.deferUpdate();
      await editProfileSettingsMessage(interaction);
    } catch (error) {
      loggers.bot.error("Error saving timezone from profile settings", error);
      await interaction.reply({
        content: "❌ Failed to save timezone.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
