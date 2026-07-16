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

function parseExcludeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

@Discord()
@SlashGroup("patrol", "settings")
@Guard(StaffGuard)
export class SettingsPatrolAloneExcludeCommand {
  @Slash({
    name: "alone-exclude-add",
    description: "Exclude a voice channel from alone-in-VC staff alerts",
  })
  async aloneExcludeAdd(
    @SlashOption({
      name: "channel",
      description: "Voice channel to exclude",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildVoice],
      required: true,
    })
    channel: GuildBasedChannel,
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

      const guildId = interaction.guildId;
      const settings = await prisma.guildSettings.upsert({
        where: { guildId },
        update: {},
        create: { guildId },
      });

      const excludeIds = parseExcludeList(settings.patrolAloneExcludeChannelIds);
      if (excludeIds.includes(channel.id)) {
        await interaction.reply({
          content: `ℹ️ <#${channel.id}> is already excluded from alone alerts.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      excludeIds.push(channel.id);
      await prisma.guildSettings.update({
        where: { guildId },
        data: { patrolAloneExcludeChannelIds: excludeIds },
      });

      patrolTimer.clearAloneWatchForChannel(guildId, channel.id);

      await patrolTimer.logCommandUsage(
        guildId,
        "settings-patrol-alone-exclude-add",
        interaction.user.id,
        undefined,
        channel.id,
      );

      await interaction.reply({
        content: `✅ <#${channel.id}> is now excluded from alone-in-VC staff alerts.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error adding alone-exclude channel", error);
      await interaction.reply({
        content: `❌ Failed to exclude channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "alone-exclude-remove",
    description: "Stop excluding a voice channel from alone-in-VC staff alerts",
  })
  async aloneExcludeRemove(
    @SlashOption({
      name: "channel",
      description: "Voice channel to stop excluding",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildVoice],
      required: true,
    })
    channel: GuildBasedChannel,
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

      const guildId = interaction.guildId;
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
      });

      const excludeIds = parseExcludeList(settings?.patrolAloneExcludeChannelIds);
      if (!excludeIds.includes(channel.id)) {
        await interaction.reply({
          content: `ℹ️ <#${channel.id}> is not on the alone-alert exclude list.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const updated = excludeIds.filter((id) => id !== channel.id);
      await prisma.guildSettings.update({
        where: { guildId },
        data: { patrolAloneExcludeChannelIds: updated },
      });

      await patrolTimer.logCommandUsage(
        guildId,
        "settings-patrol-alone-exclude-remove",
        interaction.user.id,
        undefined,
        channel.id,
      );

      await interaction.reply({
        content: `✅ <#${channel.id}> will receive alone-in-VC staff alerts again.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error removing alone-exclude channel", error);
      await interaction.reply({
        content: `❌ Failed to update exclude list: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "alone-exclude-list",
    description: "List voice channels excluded from alone-in-VC staff alerts",
  })
  async aloneExcludeList(interaction: CommandInteraction): Promise<void> {
    try {
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
      const excludeIds = parseExcludeList(settings?.patrolAloneExcludeChannelIds);

      if (excludeIds.length === 0) {
        await interaction.reply({
          content: "ℹ️ No channels are excluded from alone-in-VC staff alerts.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const lines = excludeIds.map((id) => `• <#${id}>`);
      await interaction.reply({
        content: `**Alone-alert excluded channels**\n${lines.join("\n")}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error listing alone-exclude channels", error);
      await interaction.reply({
        content: `❌ Failed to list excluded channels: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
