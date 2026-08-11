import { Discord, Guard, Slash, SlashGroup, SlashOption, SlashChoice } from "discordx";
import {
  ApplicationCommandOptionType,
  ChannelType,
  CommandInteraction,
  GuildBasedChannel,
  MessageFlags,
} from "discord.js";
import { PermissionNodeGuard } from "../../../utility/guards.js";
import {
  loggingSetupManager,
  patrolTimer,
  prisma,
} from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import {
  INVITE_FILTER_ACTIONS,
  LOGGING_THREAD_KEYS,
  LOGGING_THREAD_NAMES,
  parseLoggingThreadIds,
  type InviteFilterAction,
} from "../../../managers/logging/index.js";

@Discord()
@SlashGroup({
  description: "Audit logging and welcome channel settings",
  name: "logging",
  root: "settings",
})
@SlashGroup("logging", "settings")
@Guard(PermissionNodeGuard("settings.command.logging"))
export class SettingsLoggingCommands {
  @Slash({
    name: "setup",
    description:
      "Create a staff-logs forum with category threads, or bind an existing forum",
  })
  async setup(
    @SlashOption({
      name: "forum",
      description: "Existing forum to bind (omit to create staff-logs)",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildForum],
      required: false,
    })
    forum: GuildBasedChannel | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = forum
        ? await loggingSetupManager.bindForum(interaction.guild, forum.id)
        : await loggingSetupManager.createSetup(interaction.guild);

      try {
        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "settings-logging-setup",
          interaction.user.id,
          undefined,
          result.forumChannelId,
        );
      } catch (logError) {
        loggers.bot.warn("Failed to log logging setup", logError);
      }

      const threadLines = LOGGING_THREAD_KEYS.map(
        (key) => `• ${LOGGING_THREAD_NAMES[key]}: <#${result.threadIds[key]}>`,
      ).join("\n");

      await interaction.editReply({
        content:
          `✅ Logging ${result.createdForum ? "created" : "bound"}.\n` +
          `Forum: <#${result.forumChannelId}>\n\n${threadLines}`,
      });
    } catch (error) {
      loggers.bot.error("Failed to set up logging", error);
      await interaction.editReply({
        content: `❌ Failed to set up logging: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({
    name: "forum-channel",
    description: "Bind or clear the staff logging forum channel",
  })
  async forumChannel(
    @SlashOption({
      name: "channel",
      description: "Forum channel for staff logs",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildForum],
      required: false,
    })
    channel: GuildBasedChannel | null,
    @SlashOption({
      name: "clear",
      description: "Clear the logging forum binding",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clear: boolean | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const shouldClear = clear === true;
    if (shouldClear && channel) {
      await interaction.reply({
        content: "❌ Use either `channel` or `clear`, not both.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!channel && !shouldClear) {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
        select: { loggingForumChannelId: true, loggingThreadIds: true },
      });
      if (!settings?.loggingForumChannelId) {
        await interaction.reply({
          content: "ℹ️ No logging forum is set. Use `/settings logging setup`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const threads = parseLoggingThreadIds(settings.loggingThreadIds);
      const threadLines = LOGGING_THREAD_KEYS.map((key) => {
        const id = threads[key];
        return `• ${LOGGING_THREAD_NAMES[key]}: ${id ? `<#${id}>` : "_missing_"}`;
      }).join("\n");
      await interaction.reply({
        content: `ℹ️ Logging forum is <#${settings.loggingForumChannelId}>.\n${threadLines}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      if (shouldClear) {
        await prisma.guildSettings.upsert({
          where: { guildId: interaction.guildId },
          update: { loggingForumChannelId: null, loggingThreadIds: undefined },
          create: { guildId: interaction.guildId, loggingForumChannelId: null },
        });
        await interaction.editReply({ content: "✅ Cleared logging forum binding." });
        return;
      }

      const result = await loggingSetupManager.bindForum(
        interaction.guild,
        channel!.id,
      );
      await interaction.editReply({
        content: `✅ Logging forum set to <#${result.forumChannelId}> and category threads ensured.`,
      });
    } catch (error) {
      loggers.bot.error("Failed to bind logging forum", error);
      await interaction.editReply({
        content: `❌ ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({
    name: "welcome-channel",
    description: "Bind or clear the public welcome channel",
  })
  async welcomeChannel(
    @SlashOption({
      name: "channel",
      description: "Text channel for join welcomes",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      required: false,
    })
    channel: GuildBasedChannel | null,
    @SlashOption({
      name: "clear",
      description: "Clear the welcome channel binding",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clear: boolean | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const shouldClear = clear === true;
    if (shouldClear && channel) {
      await interaction.reply({
        content: "❌ Use either `channel` or `clear`, not both.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!channel && !shouldClear) {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
        select: { welcomeChannelId: true },
      });
      await interaction.reply({
        content: settings?.welcomeChannelId
          ? `ℹ️ Welcome channel is <#${settings.welcomeChannelId}>.`
          : "ℹ️ No welcome channel is set.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channelId = shouldClear ? null : channel!.id;
    await prisma.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      update: { welcomeChannelId: channelId },
      create: { guildId: interaction.guildId, welcomeChannelId: channelId },
    });

    await interaction.reply({
      content: shouldClear
        ? "✅ Cleared welcome channel."
        : `✅ Welcome channel set to <#${channelId}>.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "retention-days",
    description: "Set message archive / purge retention days (default 30)",
  })
  async retentionDays(
    @SlashOption({
      name: "days",
      description: "Retention in days (1–365). Omit to show current.",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 365,
    })
    days: number | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (days == null) {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
        select: { messageArchiveRetentionDays: true },
      });
      await interaction.reply({
        content: `ℹ️ Message archive retention is **${settings?.messageArchiveRetentionDays ?? 30}** days.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await prisma.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      update: { messageArchiveRetentionDays: days },
      create: {
        guildId: interaction.guildId,
        messageArchiveRetentionDays: days,
      },
    });

    await interaction.reply({
      content: `✅ Message archive retention set to **${days}** days (applies to new rows).`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "filter-invites",
    description: "Configure invite-link filter (enable + action)",
  })
  async filterInvites(
    @SlashOption({
      name: "enabled",
      description: "Enable invite filter",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    enabled: boolean | null,
    @SlashChoice(
      { name: "Log only", value: "log" },
      { name: "Delete", value: "delete" },
      { name: "Delete + timeout", value: "delete_timeout" },
    )
    @SlashOption({
      name: "action",
      description: "Action when an invite is detected",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    action: string | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (enabled == null && action == null) {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
        select: { inviteFilterEnabled: true, inviteFilterAction: true },
      });
      await interaction.reply({
        content:
          `ℹ️ Invite filter: **${settings?.inviteFilterEnabled ? "enabled" : "disabled"}**, ` +
          `action: **${settings?.inviteFilterAction ?? "log"}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action && !INVITE_FILTER_ACTIONS.includes(action as InviteFilterAction)) {
      await interaction.reply({
        content: "❌ Invalid action.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await prisma.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      update: {
        ...(enabled != null ? { inviteFilterEnabled: enabled } : {}),
        ...(action != null ? { inviteFilterAction: action } : {}),
      },
      create: {
        guildId: interaction.guildId,
        inviteFilterEnabled: enabled ?? false,
        inviteFilterAction: action ?? "log",
      },
    });

    await interaction.reply({
      content: "✅ Invite filter settings updated.",
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "status",
    description: "Show logging configuration status",
  })
  async status(interaction: CommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: interaction.guildId },
    });
    const fmt = (id: string | null | undefined) => (id ? `<#${id}>` : "_not set_");
    const threads = parseLoggingThreadIds(settings?.loggingThreadIds);

    await interaction.reply({
      content:
        `**Logging status**\n` +
        `Forum: ${fmt(settings?.loggingForumChannelId)}\n` +
        `Welcome: ${fmt(settings?.welcomeChannelId)}\n` +
        `Retention: **${settings?.messageArchiveRetentionDays ?? 30}** days\n` +
        `Invite filter: **${settings?.inviteFilterEnabled ? "on" : "off"}** / **${settings?.inviteFilterAction ?? "log"}**\n` +
        LOGGING_THREAD_KEYS.map(
          (k) => `${LOGGING_THREAD_NAMES[k]}: ${threads[k] ? `<#${threads[k]}>` : "_missing_"}`,
        ).join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
}
