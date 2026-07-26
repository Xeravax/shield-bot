import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  ChannelType,
  CommandInteraction,
  GuildBasedChannel,
  MessageFlags,
} from "discord.js";
import { PermissionNodeGuard } from "../../../utility/permissionNodes.js";
import { patrolTimer, prisma } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
@SlashGroup({
  name: "events",
  description: "Host event reminder and related settings",
  root: "settings",
})
@SlashGroup("events", "settings")
@Guard(PermissionNodeGuard("settings.command.events"))
export class SettingsEventsWeeklyReminderChannelCommand {
  @Slash({
    name: "weekly-reminder-channel",
    description: "Set the channel for the weekly Thursday host event reminder",
  })
  async weeklyReminderChannel(
    @SlashOption({
      name: "channel",
      description:
        "The channel for the weekly host / Jr. host scheduling reminder",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      required: false,
    })
    channel: GuildBasedChannel | null,
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

      if (!channel) {
        const settings = await prisma.guildSettings.findUnique({
          where: { guildId: interaction.guildId },
        });

        if (!settings?.hostWeeklyEventReminderChannelId) {
          await interaction.reply({
            content:
              "ℹ️ No weekly host event reminder channel is currently configured.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          content: `ℹ️ Weekly host event reminder channel is set to <#${settings.hostWeeklyEventReminderChannelId}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: {
          hostWeeklyEventReminderChannelId: channel.id,
        },
        create: {
          guildId: interaction.guildId,
          hostWeeklyEventReminderChannelId: channel.id,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-events-weekly-reminder-channel",
        interaction.user.id,
        undefined,
        channel.id,
      );

      await interaction.reply({
        content:
          `✅ Weekly host event reminder channel set to <#${channel.id}>. ` +
          `Posts run every **Thursday at 15:00** (Europe/Amsterdam).`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error setting weekly host event reminder channel", error);
      await interaction.reply({
        content: `❌ Failed to set channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
