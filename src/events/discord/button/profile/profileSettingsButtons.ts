import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuInteraction,
} from "discord.js";
import { ButtonComponent, Discord, SelectMenuComponent } from "discordx";
import {
  assertProfileSettingsOwner,
  editProfileSettingsMessage,
  modReasonPingDisableWarning,
} from "../../../../managers/profile/profileSettingsPanel.js";
import {
  clearUserTimezone,
  getResolvedUserPreferences,
  modReasonPingEnabled,
  updateUserPreferences,
} from "../../../../utility/userPreferences.js";
import { matchComponentId } from "../../../../utility/componentId.js";
import { loggers } from "../../../../utility/logger.js";
import {
  isAvailableLocale,
  localePickerLabel,
  t,
} from "../../../../i18n/index.js";
import { resolveLocale } from "../../../../i18n/resolveLocale.js";

const PROFILE_TOGGLE_PATROL_DM_PATTERN = /^profile-settings:toggle-patrol-dm:(\d+)$/;
const PROFILE_TOGGLE_NO_SHIELD_DM_PATTERN = /^profile-settings:toggle-no-shield-dm:(\d+)$/;
const PROFILE_TOGGLE_EVENT_STATUS_DM_PATTERN =
  /^profile-settings:toggle-event-status-dm:(\d+)$/;
const PROFILE_TOGGLE_MOD_REASON_PING_PATTERN =
  /^profile-settings:toggle-mod-reason-ping:(\d+)$/;
const PROFILE_TOGGLE_MEMBER_CARD_PATTERN =
  /^profile-settings:toggle-member-card:(\d+)$/;
const PROFILE_TIMEZONE_PATTERN = /^profile-settings:timezone:(\d+)$/;
const PROFILE_RESET_TIMEZONE_PATTERN = /^profile-settings:reset-timezone:(\d+)$/;
const PROFILE_LOCALE_PATTERN = /^profile-settings:locale:(\d+)$/;

async function replyProfileSettingsError(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
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

async function errorLocale(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<string> {
  return resolveLocale({
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
}

@Discord()
export class ProfileSettingsButtonHandlers {
  @SelectMenuComponent({ id: PROFILE_LOCALE_PATTERN })
  async selectLocale(interaction: StringSelectMenuInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, PROFILE_LOCALE_PATTERN);
    if (!match) return;

    const discordId = match[1];
    if (!(await assertProfileSettingsOwner(interaction, discordId))) {
      return;
    }

    const locale = await errorLocale(interaction);
    try {
      await interaction.deferUpdate();
      const value = interaction.values[0];
      if (value === "reset") {
        await updateUserPreferences(discordId, { locale: null });
        await editProfileSettingsMessage(interaction);
        await interaction.followUp({
          content: t(locale, "profile.language.resetDone"),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!isAvailableLocale(value)) {
        await interaction.followUp({
          content: t(locale, "settings.locale.invalid"),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await updateUserPreferences(discordId, { locale: value });
      await editProfileSettingsMessage(interaction);
      await interaction.followUp({
        content: t(value, "profile.language.updated", {
          label: localePickerLabel(value),
        }),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error("Error updating user locale preference", error);
      await replyProfileSettingsError(
        interaction,
        t(locale, "profile.language.failed"),
      );
    }
  }

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
      const locale = await errorLocale(interaction);
      await replyProfileSettingsError(
        interaction,
        t(locale, "profile.prefUpdateFailed"),
      );
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
      const locale = await errorLocale(interaction);
      await replyProfileSettingsError(
        interaction,
        t(locale, "profile.prefUpdateFailed"),
      );
    }
  }

  @ButtonComponent({ id: PROFILE_TOGGLE_EVENT_STATUS_DM_PATTERN })
  async toggleEventStatusDm(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(
      interaction.customId,
      PROFILE_TOGGLE_EVENT_STATUS_DM_PATTERN,
    );
    if (!match) return;

    const discordId = match[1];
    if (!(await assertProfileSettingsOwner(interaction, discordId))) {
      return;
    }

    try {
      await interaction.deferUpdate();
      const prefs = await getResolvedUserPreferences(discordId);
      await updateUserPreferences(discordId, {
        eventStatusDmDisabled: !prefs.eventStatusDmDisabled,
      });
      await editProfileSettingsMessage(interaction);
    } catch (error) {
      loggers.bot.error("Error toggling event status DM preference", error);
      const locale = await errorLocale(interaction);
      await replyProfileSettingsError(
        interaction,
        t(locale, "profile.prefUpdateFailed"),
      );
    }
  }

  @ButtonComponent({ id: PROFILE_TOGGLE_MOD_REASON_PING_PATTERN })
  async toggleModReasonPing(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(
      interaction.customId,
      PROFILE_TOGGLE_MOD_REASON_PING_PATTERN,
    );
    if (!match) return;

    const discordId = match[1];
    if (!(await assertProfileSettingsOwner(interaction, discordId))) {
      return;
    }

    try {
      await interaction.deferUpdate();
      const prefs = await getResolvedUserPreferences(discordId);
      const enabling = !modReasonPingEnabled(prefs);
      await updateUserPreferences(discordId, {
        modReasonPingDisabled: enabling ? false : true,
      });
      await editProfileSettingsMessage(interaction);

      if (!enabling) {
        const locale = await errorLocale(interaction);
        await interaction.followUp({
          content: modReasonPingDisableWarning(locale),
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      loggers.bot.error("Error toggling mod reason ping preference", error);
      const locale = await errorLocale(interaction);
      await replyProfileSettingsError(
        interaction,
        t(locale, "profile.prefUpdateFailed"),
      );
    }
  }

  @ButtonComponent({ id: PROFILE_TOGGLE_MEMBER_CARD_PATTERN })
  async toggleMemberCard(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(
      interaction.customId,
      PROFILE_TOGGLE_MEMBER_CARD_PATTERN,
    );
    if (!match) {
      return;
    }

    const discordId = match[1];
    if (!(await assertProfileSettingsOwner(interaction, discordId))) {
      return;
    }

    try {
      await interaction.deferUpdate();
      const prefs = await getResolvedUserPreferences(discordId);
      await updateUserPreferences(discordId, {
        memberCardPublic: !prefs.memberCardPublic,
      });
      await editProfileSettingsMessage(interaction);
    } catch (error) {
      loggers.bot.error("Error toggling public member card preference", error);
      const locale = await errorLocale(interaction);
      await replyProfileSettingsError(
        interaction,
        t(locale, "profile.prefUpdateFailed"),
      );
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

    const locale = await errorLocale(interaction);
    try {
      const prefs = await getResolvedUserPreferences(discordId);
      const input = new TextInputBuilder()
        .setCustomId("timezone")
        .setLabel(t(locale, "profile.timezone.modalLabel").slice(0, 45))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(64)
        .setPlaceholder("America/New_York")
        .setValue(prefs.timezoneStored ?? prefs.timezone);

      const modal = new ModalBuilder()
        .setCustomId(`profile-settings-modal:timezone:${discordId}`)
        .setTitle(t(locale, "profile.timezone.modalTitle").slice(0, 45))
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));

      await interaction.showModal(modal);
    } catch (error) {
      loggers.bot.error("Error opening timezone modal", error);
      await replyProfileSettingsError(
        interaction,
        t(locale, "profile.timezone.failedOpen"),
      );
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
      const locale = await errorLocale(interaction);
      await replyProfileSettingsError(
        interaction,
        t(locale, "profile.timezone.failedReset"),
      );
    }
  }
}
