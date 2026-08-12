import { Discord, Guard, Slash, SlashGroup } from "discordx";
import {
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import { PermissionNodeGuard } from "../../utility/permissionNodes.js";
import { patrolTimer, prisma, serverStatsManager } from "../../main.js";
import { loggers } from "../../utility/logger.js";

@Discord()
@SlashGroup({
  name: "server-stats",
  description: "Server stats channel operations",
})
@SlashGroup("server-stats")
@Guard(PermissionNodeGuard("settings.command.server-stats"))
export class ServerStatsCommands {
  @Slash({
    name: "refresh",
    description: "Force an immediate refresh of all configured stats channels",
  })
  async refresh(interaction: CommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const stats = await serverStatsManager.updateGuild(interaction.guildId);
      try {
        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "server-stats-refresh",
          interaction.user.id,
        );
      } catch (logError) {
        loggers.bot.warn("Failed to log server-stats refresh", logError);
      }

      if (!stats) {
        await interaction.editReply({
          content:
            "ℹ️ No server stats channels are configured, or the guild could not be updated.",
        });
        return;
      }

      await interaction.editReply({
        content:
          `✅ Refreshed server stats channels.\n` +
          `Goal: **${stats.goal}** · Members: **${stats.members}** · ` +
          `Deputies: **${stats.deputies}** · Boosts: **${stats.boosts}**`,
      });
    } catch (error) {
      loggers.bot.error("Failed to refresh server stats", error);
      await interaction.editReply({
        content: `❌ Failed to refresh: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({
    name: "status",
    description: "Show configured stats channels and live computed values",
  })
  async status(interaction: CommandInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
        select: {
          serverStatsCategoryId: true,
          serverStatsGoalChannelId: true,
          serverStatsMembersChannelId: true,
          serverStatsDeputiesChannelId: true,
          serverStatsBoostsChannelId: true,
        },
      });

      const stats = await serverStatsManager.computeStats(interaction.guild);
      const fmt = (id: string | null | undefined) =>
        id ? `<#${id}>` : "_not set_";

      await interaction.editReply({
        content:
          `**Server Stats status**\n` +
          `Category: ${fmt(settings?.serverStatsCategoryId)}\n` +
          `Goal channel: ${fmt(settings?.serverStatsGoalChannelId)} → **${stats.goal}**\n` +
          `Members channel: ${fmt(settings?.serverStatsMembersChannelId)} → **${stats.members}**\n` +
          `Deputies channel: ${fmt(settings?.serverStatsDeputiesChannelId)} → **${stats.deputies}**\n` +
          `Boosts channel: ${fmt(settings?.serverStatsBoostsChannelId)} → **${stats.boosts}**`,
      });
    } catch (error) {
      loggers.bot.error("Failed to show server stats status", error);
      await interaction.editReply({
        content: `❌ Failed to load status: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }
}
