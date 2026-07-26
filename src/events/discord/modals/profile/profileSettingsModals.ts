import { MessageFlags, ModalSubmitInteraction } from "discord.js";
import { Discord, ModalComponent } from "discordx";
import {
  editProfileSettingsMessage,
  isProfileSettingsOwner,
} from "../../../../managers/profile/profileSettingsPanel.js";
import {
  resolveTimezoneInput,
  updateUserPreferences,
} from "../../../../utility/userPreferences.js";
import { loggers } from "../../../../utility/logger.js";
import { matchComponentId } from "../../../../utility/componentId.js";

@Discord()
export class ProfileSettingsModalHandlers {
  @ModalComponent({ id: /^profile-settings-modal:timezone:(\d+)$/ })
  async handleTimezoneModal(interaction: ModalSubmitInteraction): Promise<void> {
    const match = matchComponentId(
      interaction.customId,
      /^profile-settings-modal:timezone:(\d+)$/,
    );
    if (!match) {
      await interaction.reply({
        content: "❌ Invalid modal data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const discordId = match[1];
    if (!isProfileSettingsOwner(interaction, discordId)) {
      await interaction.reply({
        content: "❌ These settings are not yours.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const timezone = interaction.fields.getTextInputValue("timezone").trim();
    const resolved = resolveTimezoneInput(timezone);
    if (!resolved) {
      await interaction.reply({
        content:
          "❌ Invalid timezone. Try a city (`America/New_York`), offset (`GMT+10` / `UTC-5`), or abbreviation (`EST`).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await updateUserPreferences(discordId, { timezone: resolved });
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
