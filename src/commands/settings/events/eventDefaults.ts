import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import { PermissionNodeGuard } from "../../../utility/guards.js";
import { patrolTimer, prisma } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

const FALLBACK_DURATION_MINUTES = 120;

@Discord()
@SlashGroup("events", "settings")
@Guard(PermissionNodeGuard("settings.command.events"))
export class SettingsEventsDefaultsCommand {
  @Slash({
    name: "event-defaults",
    description: "Set default duration for planned events",
  })
  async eventDefaults(
    @SlashOption({
      name: "duration-minutes",
      description: "Default event duration in minutes (fallback: 120)",
      type: ApplicationCommandOptionType.Integer,
      minValue: 15,
      maxValue: 24 * 60,
      required: false,
    })
    durationMinutes: number | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (durationMinutes === null) {
        const settings = await prisma.guildSettings.findUnique({
          where: { guildId: interaction.guildId },
        });

        const currentDuration =
          settings?.eventDefaultDurationMinutes ?? FALLBACK_DURATION_MINUTES;
        const locationChannel = settings?.eventLocationChannelId
          ? `<#${settings.eventLocationChannelId}> (calendar feed only)`
          : "*(none)*";

        await interaction.reply({
          content:
            `ℹ️ Current event defaults:\n` +
            `• Duration: **${currentDuration} minutes**\n` +
            `• Discord event location: External **VRChat**\n` +
            `• Calendar feed location channel: ${locationChannel}\n` +
            `_(Set calendar feed location with \`/settings events location-channel\`)_`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const settings = await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: { eventDefaultDurationMinutes: durationMinutes },
        create: {
          guildId: interaction.guildId,
          eventDefaultDurationMinutes: durationMinutes,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-events-event-defaults",
        interaction.user.id,
      );

      await interaction.reply({
        content:
          `✅ Event defaults updated:\n` +
          `• Duration: **${settings.eventDefaultDurationMinutes ?? FALLBACK_DURATION_MINUTES} minutes**`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error setting event defaults", error);
      await interaction.reply({
        content: `❌ Failed to set event defaults: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
