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
  assertProfileSettingsOwner,
  editProfileSettingsMessage,
} from "../../../../managers/profile/profileSettingsPanel.js";
import {
  clearUserTimezone,
  getResolvedUserPreferences,
  updateUserPreferences,
} from "../../../../utility/userPreferences.js";
import { matchComponentId } from "../../../../utility/componentId.js";
import { loggers } from "../../../../utility/logger.js";

const PROFILE_TOGGLE_PATROL_DM_PATTERN = /^profile-settings:toggle-patrol-dm:(\d+)$/;
const PROFILE_TOGGLE_NO_SHIELD_DM_PATTERN = /^profile-settings:toggle-no-shield-dm:(\d+)$/;
const PROFILE_TIMEZONE_PATTERN = /^profile-settings:timezone:(\d+)$/;
const PROFILE_RESET_TIMEZONE_PATTERN = /^profile-settings:reset-timezone:(\d+)$/;

async function replyProfileSettingsError(
  interaction: ButtonInteraction,
  message: string,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({
      content: message,
      flags: MessageFlags.Ephemeral,
    });
  } else {
    await interaction.reply({
      content: message,
      flags: MessageFlags.Ephemeral,
    });
  }
}

@Discord()
export class ProfileSettingsButtonHandlers {
  @ButtonComponent({ id: PROFILE_TOGGLE_PATROL_DM_PATTERN })
  async togglePatrolDm(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, PROFILE_TOGGLE_PATROL_DM_PATTERN);
    if (!match) return;

    const discordId = match[1];
    if (!(await assertProfileSettingsOwner(interaction, discordId))) {
      return;
    }

    try {
      await interaction.deferUpdate();
      const prefs = await getResolvedUserPreferences(discordId);
      await updateUserPreferences(discordId, {
        patrolDmDisabled: !prefs.patrolDmDisabled,
      });
      await editProfileSettingsMessage(interaction);
    } catch (error) {
      loggers.bot.error("Error toggling patrol DM preference", error);
      await replyProfileSettingsError(interaction, "❌ Failed to update preference.");
    }
  }

  @ButtonComponent({ id: PROFILE_TOGGLE_NO_SHIELD_DM_PATTERN })
  async toggleNoShieldDm(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, PROFILE_TOGGLE_NO_SHIELD_DM_PATTERN);
    if (!match) return;

    const discordId = match[1];
    if (!(await assertProfileSettingsOwner(interaction, discordId))) {
      return;
    }

    try {
      await interaction.deferUpdate();
      const prefs = await getResolvedUserPreferences(discordId);
      await updateUserPreferences(discordId, {
        patrolNoShieldMemberDmDisabled: !prefs.patrolNoShieldMemberDmDisabled,
      });
      await editProfileSettingsMessage(interaction);
    } catch (error) {
      loggers.bot.error("Error toggling no-shield patrol DM preference", error);
      await replyProfileSettingsError(interaction, "❌ Failed to update preference.");
    }
  }

  @ButtonComponent({ id: PROFILE_TIMEZONE_PATTERN })
  async openTimezoneModal(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, PROFILE_TIMEZONE_PATTERN);
    if (!match) return;

    const discordId = match[1];
    if (!(await assertProfileSettingsOwner(interaction, discordId))) {
      return;
    }

    try {
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
    } catch (error) {
      loggers.bot.error("Error opening timezone modal", error);
      await replyProfileSettingsError(interaction, "❌ Could not open the timezone form.");
    }
  }

  @ButtonComponent({ id: PROFILE_RESET_TIMEZONE_PATTERN })
  async resetTimezone(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, PROFILE_RESET_TIMEZONE_PATTERN);
    if (!match) return;

    const discordId = match[1];
    if (!(await assertProfileSettingsOwner(interaction, discordId))) {
      return;
    }

    try {
      await interaction.deferUpdate();
      await clearUserTimezone(discordId);
      await editProfileSettingsMessage(interaction);
    } catch (error) {
      loggers.bot.error("Error resetting user timezone", error);
      await replyProfileSettingsError(interaction, "❌ Failed to reset timezone.");
    }
  }
}
