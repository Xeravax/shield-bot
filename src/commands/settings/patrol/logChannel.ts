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
export class SettingsPatrolLogChannelCommand {
  @Slash({
    name: "log-channel",
    description: "Set the channel for patrol hours and command usage logs",
  })
  async logChannel(
    @SlashOption({
      name: "channel",
      description: "The channel to send patrol logs to",
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

      // If no channel provided, show current setting (view only – no log)
      if (!channel) {
        const settings = await prisma.guildSettings.findUnique({
          where: { guildId: interaction.guildId },
        });

        if (!settings?.patrolLogChannelId) {
          await interaction.reply({
            content: "ℹ️ No patrol log channel is currently configured.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          content: `ℹ️ Patrol log channel is currently set to <#${settings.patrolLogChannelId}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Update the setting
      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: {
          patrolLogChannelId: channel.id,
        },
        create: {
          guildId: interaction.guildId,
          patrolLogChannelId: channel.id,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-patrol-log-channel",
        interaction.user.id,
        undefined,
        channel.id,
      );

      await interaction.reply({
        content: `✅ Patrol log channel has been set to <#${channel.id}>`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error setting patrol log channel", error);
      await interaction.reply({
        content: `❌ Failed to set patrol log channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
