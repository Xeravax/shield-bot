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
@SlashGroup("attendance", "settings")
@Guard(StaffGuard)
export class SettingsAttendanceAOCCommand {
  @Slash({
    name: "aoc-channel",
    description: "Set the AOC (Attendance Operations Center) channel ID",
  })
  async aocChannel(
    @SlashOption({
      name: "channel",
      description: "The channel ID for AOC squad",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    channelId: string | null,
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

      // If no channel ID provided, show current setting
      if (!channelId) {
        const settings = await prisma.guildSettings.findUnique({
          where: { guildId: interaction.guildId },
        });

        const aocChannelId = (settings as { aocChannelId?: string | null } | null)?.aocChannelId;
        if (!aocChannelId) {
          await interaction.reply({
            content: "ℹ️ No AOC channel is currently configured.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const channel = interaction.guild?.channels.cache.get(aocChannelId);
        const channelMention = channel ? `<#${aocChannelId}>` : aocChannelId;
        await interaction.reply({
          content: `ℹ️ AOC channel is currently set to ${channelMention}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Validate channel ID format (should be numeric)
      if (!/^\d+$/.test(channelId)) {
        await interaction.reply({
          content: "❌ Invalid channel ID format. Channel IDs should be numeric.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Update the setting
      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: {
          aocChannelId: channelId,
        },
        create: {
          guildId: interaction.guildId,
          aocChannelId: channelId,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-attendance-aoc-channel",
        interaction.user.id,
        undefined,
        channelId,
      );

      const channel = interaction.guild?.channels.cache.get(channelId);
      const channelMention = channel ? `<#${channelId}>` : channelId;
      await interaction.reply({
        content: `✅ AOC channel has been set to ${channelMention}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error setting AOC channel", error);
      await interaction.reply({
        content: `❌ Failed to set AOC channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "instigation-log-channel",
    description: "Set the instigation log channel ID for AOC lead reminders",
  })
  async instigationLogChannel(
    @SlashOption({
      name: "channel",
      description: "The channel ID for instigation logs",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildText],
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

        const instigationLogChannelId = (settings as { instigationLogChannelId?: string | null } | null)?.instigationLogChannelId;
        if (!instigationLogChannelId) {
          await interaction.reply({
            content: "ℹ️ No instigation log channel is currently configured.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          content: `ℹ️ Instigation log channel is currently set to <#${instigationLogChannelId}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Update the setting
      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: {
          instigationLogChannelId: channel.id,
        },
        create: {
          guildId: interaction.guildId,
          instigationLogChannelId: channel.id,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-attendance-instigation-log-channel",
        interaction.user.id,
        undefined,
        channel.id,
      );

      await interaction.reply({
        content: `✅ Instigation log channel has been set to <#${channel.id}>`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error setting instigation log channel", error);
      await interaction.reply({
        content: `❌ Failed to set instigation log channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
