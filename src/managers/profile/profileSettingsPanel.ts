import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Colors,
  CommandInteraction,
  EmbedBuilder,
  MessageActionRowComponentBuilder,
  MessageFlags,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import {
  formatTimezoneDisplay,
  getResolvedUserPreferences,
  noShieldMemberDmEnabled,
  patrolDmEnabled,
  eventStatusDmEnabled,
  modReasonPingEnabled,
  memberCardPublicEnabled,
  type ResolvedUserPreferences,
} from "../../utility/userPreferences.js";
import { EVENT_TIMEZONE } from "../../utility/estTime.js";
import {
  DEFAULT_LOCALE,
  getLocalePickerOptions,
  localePickerLabel,
  t,
} from "../../i18n/index.js";
import { resolveLocale } from "../../i18n/resolveLocale.js";

type ProfileSettingsInteraction =
  | ButtonInteraction
  | ModalSubmitInteraction
  | StringSelectMenuInteraction;

export function modReasonPingDisableWarning(locale: string): string {
  return t(locale, "profile.modReasonPing.disableWarning");
}

/** @deprecated Use modReasonPingDisableWarning(locale) */
export const MOD_REASON_PING_DISABLE_WARNING =
  "⚠️ By disabling mod reason pings, **you become responsible** for providing reasons for your own moderating actions. Failure to do so may result in punishment by higher staff.";

export function buildProfileSettingsEmbed(
  prefs: ResolvedUserPreferences,
  locale: string,
  guildLocaleLabel: string,
): EmbedBuilder {
  const timezoneLine = prefs.timezoneStored
    ? formatTimezoneDisplay(prefs.timezone)
    : `${formatTimezoneDisplay(EVENT_TIMEZONE)} ${t(locale, "common.default")}`;

  const languageLine = prefs.localeStored
    ? localePickerLabel(prefs.localeStored)
    : `${guildLocaleLabel} ${t(locale, "common.default")}`;

  return new EmbedBuilder()
    .setTitle(t(locale, "profile.title"))
    .setColor(Colors.Blurple)
    .setDescription(t(locale, "profile.description"))
    .addFields(
      {
        name: t(locale, "profile.language.name"),
        value: `${languageLine}\n${t(locale, "profile.language.help")}`,
        inline: false,
      },
      {
        name: t(locale, "profile.timezone.name"),
        value: `${timezoneLine}\n${t(locale, "profile.timezone.help")}`,
        inline: false,
      },
      {
        name: t(locale, "profile.patrolDm.name"),
        value: patrolDmEnabled(prefs)
          ? t(locale, "profile.patrolDm.on")
          : t(locale, "profile.patrolDm.off"),
        inline: false,
      },
      {
        name: t(locale, "profile.joinReminders.name"),
        value: noShieldMemberDmEnabled(prefs)
          ? t(locale, "profile.joinReminders.on")
          : t(locale, "profile.joinReminders.off"),
        inline: false,
      },
      {
        name: t(locale, "profile.eventStatus.name"),
        value: eventStatusDmEnabled(prefs)
          ? t(locale, "profile.eventStatus.on")
          : t(locale, "profile.eventStatus.off"),
        inline: false,
      },
      {
        name: t(locale, "profile.modReasonPing.name"),
        value: modReasonPingEnabled(prefs)
          ? t(locale, "profile.modReasonPing.on")
          : t(locale, "profile.modReasonPing.off"),
        inline: false,
      },
      {
        name: t(locale, "profile.memberCard.name"),
        value: memberCardPublicEnabled(prefs)
          ? t(locale, "profile.memberCard.on")
          : t(locale, "profile.memberCard.off"),
        inline: false,
      },
    )
    .setFooter({ text: t(locale, "profile.footer") });
}

export function buildProfileSettingsComponents(
  discordId: string,
  prefs: ResolvedUserPreferences,
  locale: string,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const patrolLabel = patrolDmEnabled(prefs)
    ? t(locale, "profile.patrolDm.buttonOn")
    : t(locale, "profile.patrolDm.buttonOff");
  const shieldLabel = noShieldMemberDmEnabled(prefs)
    ? t(locale, "profile.joinReminders.buttonOn")
    : t(locale, "profile.joinReminders.buttonOff");
  const eventStatusLabel = eventStatusDmEnabled(prefs)
    ? t(locale, "profile.eventStatus.buttonOn")
    : t(locale, "profile.eventStatus.buttonOff");
  const modReasonPingLabel = modReasonPingEnabled(prefs)
    ? t(locale, "profile.modReasonPing.buttonOn")
    : t(locale, "profile.modReasonPing.buttonOff");
  const memberCardLabel = memberCardPublicEnabled(prefs)
    ? t(locale, "profile.memberCard.buttonOn")
    : t(locale, "profile.memberCard.buttonOff");

  const languageSelect = new StringSelectMenuBuilder()
    .setCustomId(`profile-settings:locale:${discordId}`)
    .setPlaceholder(t(locale, "profile.language.selectPlaceholder"))
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(t(locale, "common.followGuild").slice(0, 100))
        .setValue("reset")
        .setDefault(!prefs.localeStored),
      ...getLocalePickerOptions().map((o) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(o.label.slice(0, 100))
          .setValue(o.code)
          .setDefault(prefs.localeStored === o.code),
      ),
    );

  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      languageSelect,
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`profile-settings:toggle-patrol-dm:${discordId}`)
        .setLabel(patrolLabel.slice(0, 80))
        .setStyle(
          patrolDmEnabled(prefs) ? ButtonStyle.Success : ButtonStyle.Secondary,
        ),
      new ButtonBuilder()
        .setCustomId(`profile-settings:toggle-no-shield-dm:${discordId}`)
        .setLabel(shieldLabel.slice(0, 80))
        .setStyle(
          noShieldMemberDmEnabled(prefs)
            ? ButtonStyle.Success
            : ButtonStyle.Secondary,
        ),
      new ButtonBuilder()
        .setCustomId(`profile-settings:toggle-event-status-dm:${discordId}`)
        .setLabel(eventStatusLabel.slice(0, 80))
        .setStyle(
          eventStatusDmEnabled(prefs)
            ? ButtonStyle.Success
            : ButtonStyle.Secondary,
        ),
      new ButtonBuilder()
        .setCustomId(`profile-settings:toggle-mod-reason-ping:${discordId}`)
        .setLabel(modReasonPingLabel.slice(0, 80))
        .setStyle(
          modReasonPingEnabled(prefs)
            ? ButtonStyle.Success
            : ButtonStyle.Secondary,
        ),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`profile-settings:timezone:${discordId}`)
        .setLabel(t(locale, "profile.timezone.change").slice(0, 80))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`profile-settings:reset-timezone:${discordId}`)
        .setLabel(t(locale, "profile.timezone.reset").slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!prefs.timezoneStored),
      new ButtonBuilder()
        .setCustomId(`profile-settings:toggle-member-card:${discordId}`)
        .setLabel(memberCardLabel.slice(0, 80))
        .setStyle(
          memberCardPublicEnabled(prefs)
            ? ButtonStyle.Success
            : ButtonStyle.Secondary,
        ),
    ),
  ];
}

export async function buildProfileSettingsPanel(
  discordId: string,
  guildId?: string | null,
): Promise<{
  embed: EmbedBuilder;
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  locale: string;
}> {
  const prefs = await getResolvedUserPreferences(discordId);
  const locale = await resolveLocale({ userId: discordId, guildId });
  const guildLocale = await resolveLocale({ guildId: guildId ?? null });
  const guildLocaleLabel = localePickerLabel(guildLocale || DEFAULT_LOCALE);
  return {
    embed: buildProfileSettingsEmbed(prefs, locale, guildLocaleLabel),
    components: buildProfileSettingsComponents(discordId, prefs, locale),
    locale,
  };
}

export async function replyWithProfileSettings(
  interaction: CommandInteraction,
): Promise<void> {
  const { embed, components } = await buildProfileSettingsPanel(
    interaction.user.id,
    interaction.guildId,
  );
  await interaction.reply({
    embeds: [embed],
    components,
    flags: MessageFlags.Ephemeral,
  });
}

export async function editProfileSettingsMessage(
  interaction: ProfileSettingsInteraction,
): Promise<void> {
  const { embed, components } = await buildProfileSettingsPanel(
    interaction.user.id,
    interaction.guildId,
  );
  const payload = { embeds: [embed], components, content: null };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return;
  }

  if (interaction.isMessageComponent()) {
    await interaction.update(payload);
  }
}

export function isProfileSettingsOwner(
  interaction: ProfileSettingsInteraction,
  discordId: string,
): boolean {
  return interaction.user.id === discordId;
}

export async function assertProfileSettingsOwner(
  interaction: ProfileSettingsInteraction,
  discordId: string,
): Promise<boolean> {
  if (isProfileSettingsOwner(interaction, discordId)) {
    return true;
  }
  const locale = await resolveLocale({
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
  await interaction.reply({
    content: t(locale, "common.notYours"),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}
