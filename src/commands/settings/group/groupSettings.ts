import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  EmbedBuilder,
  Colors,
  GuildBasedChannel,
  MessageFlags,
} from "discord.js";
import { StaffGuard } from "../../../utility/guards.js";
import { patrolTimer, prisma } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
@SlashGroup("group", "settings")
@Guard(StaffGuard)
export class GroupSettingsCommand {
  @Slash({
    name: "set-group-id",
    description: "Set the VRChat group ID for this server",
  })
  async setGroupId(
    @SlashOption({
      name: "group_id",
      description: "VRChat group ID (e.g., grp_xxx)",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    groupId: string,
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

      // Validate group ID format
      if (!groupId.startsWith("grp_")) {
        await interaction.reply({
          content: "❌ Invalid group ID format. It should start with 'grp_'.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Update guild settings
      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: { vrcGroupId: groupId },
        create: {
          guildId: interaction.guildId,
          vrcGroupId: groupId,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-group-set-group-id",
        interaction.user.id,
        undefined,
        groupId,
      );

      const embed = new EmbedBuilder()
        .setTitle("✅ VRChat Group ID Set")
        .setDescription(
          `The VRChat group ID has been set to \`${groupId}\`.\n\nVerified users will now be offered to join this group, and role syncing will be enabled.`,
        )
        .setColor(Colors.Green)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Settings" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error: unknown) {
      loggers.bot.error("Error setting group ID", error);
      await interaction.reply({
        content: `❌ Failed to set group ID: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "view-group-id",
    description: "View the current VRChat group ID for this server",
  })
  async viewGroupId(interaction: CommandInteraction): Promise<void> {
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

      if (!settings?.vrcGroupId) {
        await interaction.reply({
          content: "ℹ️ No VRChat group ID is currently configured.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("VRChat Group ID")
        .setDescription(`Current group ID: \`${settings.vrcGroupId}\``)
        .setColor(Colors.Blue)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Settings" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error: unknown) {
      loggers.bot.error("Error viewing group ID", error);
      await interaction.reply({
        content: `❌ Failed to view group ID: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "clear-group-id",
    description: "Remove the VRChat group ID configuration",
  })
  async clearGroupId(interaction: CommandInteraction): Promise<void> {
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

      if (!settings?.vrcGroupId) {
        await interaction.reply({
          content: "ℹ️ No VRChat group ID is currently configured.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.guildSettings.update({
        where: { guildId: interaction.guildId },
        data: { vrcGroupId: null },
      });

      const embed = new EmbedBuilder()
        .setTitle("✅ VRChat Group ID Cleared")
        .setDescription(
          "The VRChat group ID has been removed. Group invites and role syncing are now disabled.",
        )
        .setColor(Colors.Green)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Settings" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error: unknown) {
      loggers.bot.error("Error clearing group ID", error);
      await interaction.reply({
        content: `❌ Failed to clear group ID: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "set-promotion-logs",
    description:
      "Set the channel for VRChat group promotion/demotion notifications",
  })
  async setPromotionLogs(
    @SlashOption({
      name: "channel",
      description: "Channel for promotion logs",
      type: ApplicationCommandOptionType.Channel,
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

      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: { botPromotionLogsChannelId: channel.id },
        create: {
          guildId: interaction.guildId,
          botPromotionLogsChannelId: channel.id,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-group-promotion-logs",
        interaction.user.id,
        undefined,
        channel.id,
      );

      const embed = new EmbedBuilder()
        .setTitle("✅ Promotion Logs Channel Set")
        .setDescription(
          `VRChat group role changes will now be logged to <#${channel.id}>.`,
        )
        .setColor(Colors.Green)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Settings" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error: unknown) {
      loggers.bot.error("Error setting promotion logs", error);
      await interaction.reply({
        content: `❌ Failed to set promotion logs channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "clear-promotion-logs",
    description: "Remove the promotion logs channel configuration",
  })
  async clearPromotionLogs(interaction: CommandInteraction): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.guildSettings.update({
        where: { guildId: interaction.guildId },
        data: { botPromotionLogsChannelId: null },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-group-promotion-logs",
        interaction.user.id,
        undefined,
        "removed",
      );

      const embed = new EmbedBuilder()
        .setTitle("✅ Promotion Logs Cleared")
        .setDescription("Promotion logs channel has been removed.")
        .setColor(Colors.Green)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Settings" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error: unknown) {
      loggers.bot.error("Error clearing promotion logs", error);
      await interaction.reply({
        content: `❌ Failed to clear promotion logs: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
