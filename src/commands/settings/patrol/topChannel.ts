import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  CommandInteraction,
  ChannelType,
  ApplicationCommandOptionType,
  GuildBasedChannel,
  MessageFlags,
} from "discord.js";
import { StaffGuard } from "../../../utility/guards.js";
import { patrolTimer, prisma } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
@SlashGroup("patrol", "settings")
@Guard(StaffGuard)
export class SettingsPatrolTopChannelCommand {
  @Slash({
    name: "top-channel",
    description: "Set the channel for weekly patrol top posts",
  })
  async topChannel(
    @SlashOption({
      name: "channel",
      description: "The channel to send weekly patrol top posts to",
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

      // If no channel provided, show current setting
      if (!channel) {
        const settings = await prisma.guildSettings.findUnique({
          where: { guildId: interaction.guildId },
        });

        if (!settings?.patrolTopChannelId) {
          await interaction.reply({
            content: "ℹ️ No patrol top channel is currently configured.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          content: `ℹ️ Patrol top channel is currently set to <#${settings.patrolTopChannelId}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Update the setting
      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: {
          patrolTopChannelId: channel.id,
        },
        create: {
          guildId: interaction.guildId,
          patrolTopChannelId: channel.id,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-patrol-top-channel",
        interaction.user.id,
        undefined,
        channel.id,
      );

      await interaction.reply({
        content: `✅ Patrol top channel has been set to <#${channel.id}>. Weekly top posts will be sent every Sunday at 3AM UTC.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error setting patrol top channel", error);
      await interaction.reply({
        content: `❌ Failed to set patrol top channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

