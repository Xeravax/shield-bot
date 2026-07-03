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
} from "discord.js";
import {
  formatTimezoneDisplay,
  getResolvedUserPreferences,
  noShieldMemberDmEnabled,
  patrolDmEnabled,
  type ResolvedUserPreferences,
} from "../../utility/userPreferences.js";
import { EVENT_TIMEZONE } from "../../utility/estTime.js";

type ProfileSettingsInteraction = ButtonInteraction | ModalSubmitInteraction;

export function buildProfileSettingsEmbed(
  prefs: ResolvedUserPreferences,
): EmbedBuilder {
  const timezoneLine = prefs.timezoneStored
    ? formatTimezoneDisplay(prefs.timezone)
    : `${formatTimezoneDisplay(EVENT_TIMEZONE)} *(default)*`;

  return new EmbedBuilder()
    .setTitle("Profile Settings")
    .setColor(Colors.Blurple)
    .setDescription("Manage your personal bot preferences below.")
    .addFields(
      {
        name: "Timezone",
        value:
          `${timezoneLine}\n` +
          "Used when you type natural-language times (e.g. \"Saturday 8pm\"). Unix timestamps are always absolute.",
        inline: false,
      },
      {
        name: "Patrol completion DMs",
        value: patrolDmEnabled(prefs)
          ? "✅ **Enabled** — you receive a DM when a patrol session completes."
          : "❌ **Disabled** — no completion DMs.",
        inline: false,
      },
      {
        name: "Patrol join reminders",
        value: noShieldMemberDmEnabled(prefs)
          ? "✅ **Enabled** — you may be DM'd when joining patrol without the Shield Member role."
          : "❌ **Disabled** — no join reminders.",
        inline: false,
      },
    )
    .setFooter({ text: "Event scheduling rules (Monday ban, weekly limits) always use EST." });
}

export function buildProfileSettingsComponents(
  discordId: string,
  prefs: ResolvedUserPreferences,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const patrolLabel = patrolDmEnabled(prefs) ? "Patrol DMs: On" : "Patrol DMs: Off";
  const shieldLabel = noShieldMemberDmEnabled(prefs)
    ? "Join reminders: On"
    : "Join reminders: Off";

  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`profile-settings:toggle-patrol-dm:${discordId}`)
        .setLabel(patrolLabel)
        .setStyle(
          patrolDmEnabled(prefs) ? ButtonStyle.Success : ButtonStyle.Secondary,
        ),
      new ButtonBuilder()
        .setCustomId(`profile-settings:toggle-no-shield-dm:${discordId}`)
        .setLabel(shieldLabel)
        .setStyle(
          noShieldMemberDmEnabled(prefs)
            ? ButtonStyle.Success
            : ButtonStyle.Secondary,
        ),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`profile-settings:timezone:${discordId}`)
        .setLabel("Change timezone")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`profile-settings:reset-timezone:${discordId}`)
        .setLabel("Reset timezone to default")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!prefs.timezoneStored),
    ),
  ];
}

export async function buildProfileSettingsPanel(discordId: string): Promise<{
  embed: EmbedBuilder;
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}> {
  const prefs = await getResolvedUserPreferences(discordId);
  return {
    embed: buildProfileSettingsEmbed(prefs),
    components: buildProfileSettingsComponents(discordId, prefs),
  };
}

export async function replyWithProfileSettings(
  interaction: CommandInteraction,
): Promise<void> {
  const { embed, components } = await buildProfileSettingsPanel(interaction.user.id);
  await interaction.reply({
    embeds: [embed],
    components,
    flags: MessageFlags.Ephemeral,
  });
}

export async function editProfileSettingsMessage(
  interaction: ProfileSettingsInteraction,
): Promise<void> {
  const { embed, components } = await buildProfileSettingsPanel(interaction.user.id);
  const payload = { embeds: [embed], components, content: null };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
    return;
  }

  if (interaction.isMessageComponent() && interaction.message.editable) {
    await interaction.message.edit(payload);
  }
}

export function isProfileSettingsOwner(
  interaction: ProfileSettingsInteraction,
  discordId: string,
): boolean {
  return interaction.user.id === discordId;
}
