import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  ChannelType,
  CommandInteraction,
  GuildBasedChannel,
  MessageFlags,
} from "discord.js";
import { PermissionNodeGuard } from "../../../utility/permissionNodes.js";
import { patrolTimer, prisma, serverStatsManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

type StatsChannelField =
  | "serverStatsGoalChannelId"
  | "serverStatsMembersChannelId"
  | "serverStatsDeputiesChannelId"
  | "serverStatsBoostsChannelId";

async function bindOrShowChannel(
  interaction: CommandInteraction,
  options: {
    field: StatsChannelField;
    label: string;
    channel: GuildBasedChannel | null;
    clear: boolean | null;
    logKey: string;
  },
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const shouldClear = options.clear === true;
  if (shouldClear && options.channel) {
    await interaction.reply({
      content: "❌ Use either `channel` or `clear`, not both.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!options.channel && !shouldClear) {
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: interaction.guildId },
    });
    const channelId = settings?.[options.field];
    if (!channelId) {
      await interaction.reply({
        content: `ℹ️ No ${options.label} channel is set.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content: `ℹ️ ${options.label} channel is <#${channelId}>.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channelId: string | null = shouldClear
    ? null
    : options.channel
      ? options.channel.id
      : null;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await prisma.guildSettings.upsert({
    where: { guildId: interaction.guildId },
    update: { [options.field]: channelId },
    create: {
      guildId: interaction.guildId,
      [options.field]: channelId,
    },
  });

  try {
    await patrolTimer.logCommandUsage(
      interaction.guildId,
      options.logKey,
      interaction.user.id,
      undefined,
      channelId ?? undefined,
    );
  } catch (logError) {
    loggers.bot.warn(`Failed to log ${options.logKey}`, logError);
  }

  if (!shouldClear && channelId) {
    void serverStatsManager.updateGuild(interaction.guildId);
  }

  await interaction.editReply({
    content: shouldClear
      ? `✅ Cleared ${options.label} channel.`
      : `✅ ${options.label} channel set to <#${channelId}>.`,
  });
}

@Discord()
@SlashGroup({
  description: "Server stats display channel settings",
  name: "server-stats",
  root: "settings",
})
@SlashGroup("server-stats", "settings")
@Guard(PermissionNodeGuard("settings.command.server-stats"))
export class SettingsServerStatsCommands {
  @Slash({
    name: "setup",
    description:
      "Create a Server Stats category with Goal, Members, Deputies, and Boosts channels",
  })
  async setup(interaction: CommandInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await serverStatsManager.createSetup(interaction.guild);

      try {
        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "settings-server-stats-setup",
          interaction.user.id,
          undefined,
          result.categoryId,
        );
      } catch (logError) {
        loggers.bot.warn("Failed to log server-stats setup", logError);
      }

      await interaction.editReply({
        content:
          `✅ Created Server Stats channels:\n` +
          `• Goal: <#${result.goalChannelId}>\n` +
          `• Members: <#${result.membersChannelId}>\n` +
          `• Deputies: <#${result.deputiesChannelId}>\n` +
          `• Boosts: <#${result.boostsChannelId}>\n\n` +
          `Current values — Goal: **${result.stats.goal}**, Members: **${result.stats.members}**, ` +
          `Deputies: **${result.stats.deputies}**, Boosts: **${result.stats.boosts}**.`,
      });
    } catch (error) {
      loggers.bot.error("Failed to set up server stats channels", error);
      await interaction.editReply({
        content: `❌ Failed to set up channels: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({
    name: "goal-channel",
    description: "Bind or clear the Current Goal stats voice channel",
  })
  async goalChannel(
    @SlashOption({
      name: "channel",
      description: "Voice channel to use for Current Goal",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildVoice],
      required: false,
    })
    channel: GuildBasedChannel | null,
    @SlashOption({
      name: "clear",
      description: "Clear the Goal channel binding",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clear: boolean | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    await bindOrShowChannel(interaction, {
      field: "serverStatsGoalChannelId",
      label: "Current Goal",
      channel,
      clear,
      logKey: "settings-server-stats-goal-channel",
    });
  }

  @Slash({
    name: "members-channel",
    description: "Bind or clear the Members stats voice channel",
  })
  async membersChannel(
    @SlashOption({
      name: "channel",
      description: "Voice channel to use for Members",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildVoice],
      required: false,
    })
    channel: GuildBasedChannel | null,
    @SlashOption({
      name: "clear",
      description: "Clear the Members channel binding",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clear: boolean | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    await bindOrShowChannel(interaction, {
      field: "serverStatsMembersChannelId",
      label: "Members",
      channel,
      clear,
      logKey: "settings-server-stats-members-channel",
    });
  }

  @Slash({
    name: "deputies-channel",
    description: "Bind or clear the Deputies stats voice channel",
  })
  async deputiesChannel(
    @SlashOption({
      name: "channel",
      description: "Voice channel to use for Deputies",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildVoice],
      required: false,
    })
    channel: GuildBasedChannel | null,
    @SlashOption({
      name: "clear",
      description: "Clear the Deputies channel binding",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clear: boolean | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    await bindOrShowChannel(interaction, {
      field: "serverStatsDeputiesChannelId",
      label: "Deputies",
      channel,
      clear,
      logKey: "settings-server-stats-deputies-channel",
    });
  }

  @Slash({
    name: "boosts-channel",
    description: "Bind or clear the Boosts stats voice channel",
  })
  async boostsChannel(
    @SlashOption({
      name: "channel",
      description: "Voice channel to use for Boosts",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildVoice],
      required: false,
    })
    channel: GuildBasedChannel | null,
    @SlashOption({
      name: "clear",
      description: "Clear the Boosts channel binding",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clear: boolean | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    await bindOrShowChannel(interaction, {
      field: "serverStatsBoostsChannelId",
      label: "Boosts",
      channel,
      clear,
      logKey: "settings-server-stats-boosts-channel",
    });
  }

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
          "settings-server-stats-refresh",
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
