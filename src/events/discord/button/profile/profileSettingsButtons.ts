import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { ButtonComponent, Discord } from "discordx";
import {
  editProfileSettingsMessage,
  isProfileSettingsOwner,
} from "../../../../managers/profile/profileSettingsPanel.js";
import {
  clearUserTimezone,
  getResolvedUserPreferences,
  updateUserPreferences,
} from "../../../../utility/userPreferences.js";
import { loggers } from "../../../../utility/logger.js";

@Discord()
export class ProfileSettingsButtonHandlers {
  @ButtonComponent({ id: /^profile-settings:toggle-patrol-dm:(\d+)$/ })
  async togglePatrolDm(interaction: ButtonInteraction): Promise<void> {
    const discordId = interaction.customId.split(":")[2];
    if (!isProfileSettingsOwner(interaction, discordId)) {
      await interaction.reply({
        content: "❌ These settings are not yours.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const prefs = await getResolvedUserPreferences(discordId);
      await updateUserPreferences(discordId, {
        patrolDmDisabled: !prefs.patrolDmDisabled,
      });
      await interaction.deferUpdate();
      await editProfileSettingsMessage(interaction);
    } catch (error) {
      loggers.bot.error("Error toggling patrol DM preference", error);
      await interaction.reply({
        content: "❌ Failed to update preference.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ButtonComponent({ id: /^profile-settings:toggle-no-shield-dm:(\d+)$/ })
  async toggleNoShieldDm(interaction: ButtonInteraction): Promise<void> {
    const discordId = interaction.customId.split(":")[2];
    if (!isProfileSettingsOwner(interaction, discordId)) {
      await interaction.reply({
        content: "❌ These settings are not yours.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const prefs = await getResolvedUserPreferences(discordId);
      await updateUserPreferences(discordId, {
        patrolNoShieldMemberDmDisabled: !prefs.patrolNoShieldMemberDmDisabled,
      });
      await interaction.deferUpdate();
      await editProfileSettingsMessage(interaction);
    } catch (error) {
      loggers.bot.error("Error toggling no-shield patrol DM preference", error);
      await interaction.reply({
        content: "❌ Failed to update preference.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ButtonComponent({ id: /^profile-settings:timezone:(\d+)$/ })
  async openTimezoneModal(interaction: ButtonInteraction): Promise<void> {
    const discordId = interaction.customId.split(":")[2];
    if (!isProfileSettingsOwner(interaction, discordId)) {
      await interaction.reply({
        content: "❌ These settings are not yours.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const prefs = await getResolvedUserPreferences(discordId);
    const input = new TextInputBuilder()
      .setCustomId("timezone")
      .setLabel("IANA timezone")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(64)
      .setPlaceholder("America/New_York")
      .setValue(prefs.timezoneStored ?? prefs.timezone);

    const modal = new ModalBuilder()
      .setCustomId(`profile-settings-modal:timezone:${discordId}`)
      .setTitle("Change timezone")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^profile-settings:reset-timezone:(\d+)$/ })
  async resetTimezone(interaction: ButtonInteraction): Promise<void> {
    const discordId = interaction.customId.split(":")[2];
    if (!isProfileSettingsOwner(interaction, discordId)) {
      await interaction.reply({
        content: "❌ These settings are not yours.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await clearUserTimezone(discordId);
      await interaction.deferUpdate();
      await editProfileSettingsMessage(interaction);
    } catch (error) {
      loggers.bot.error("Error resetting user timezone", error);
      await interaction.reply({
        content: "❌ Failed to reset timezone.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
