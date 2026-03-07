import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  CommandInteraction,
  MessageFlags,
  ApplicationCommandOptionType,
  Role,
  ChannelType,
  TextChannel,
  NewsChannel,
} from "discord.js";
import { StaffGuard } from "../../../utility/guards.js";
import { patrolTimer, prisma } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
@SlashGroup({
  description: "LOA settings",
  name: "loa",
  root: "settings",
})
@SlashGroup("loa", "settings")
@Guard(StaffGuard)
export class SettingsLOASubGroup {
  /**
   * Helper method to update a guild setting with error handling
   */
  private async updateGuildSetting(
    interaction: CommandInteraction,
    field: string,
    value: string | number | null,
    successMessage: string,
    errorContext: string,
    errorMessage: string,
    logAction?: string,
    logDetails?: string,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: { [field]: value },
        create: {
          guildId: interaction.guildId,
          [field]: value,
        },
      });

      if (logAction) {
        await patrolTimer.logCommandUsage(
          interaction.guildId,
          logAction,
          interaction.user.id,
          undefined,
          logDetails ?? (typeof value === "string" ? value : String(value)),
        );
      }

      await interaction.reply({
        content: successMessage,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error(errorContext, error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  @Slash({
    name: "role",
    description: "Set the LOA role for this guild",
  })
  async setRole(
    @SlashOption({
      name: "role",
      description: "The role to assign to users on LOA",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    role: Role,
    interaction: CommandInteraction,
  ) {
    await this.updateGuildSetting(
      interaction,
      "loaRoleId",
      role.id,
      `✅ LOA role set to: ${role.name} (<@&${role.id}>)`,
      "Error setting LOA role",
      "❌ Failed to set LOA role. Please try again.",
      "settings-loa-role",
      role.id,
    );
  }

  @Slash({
    name: "notification-channel",
    description: "Set the channel for LOA patrol notifications",
  })
  async setNotificationChannel(
    @SlashOption({
      name: "channel",
      description: "The channel where staff will be notified when users on LOA join patrol",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      required: true,
    })
    channel: TextChannel | NewsChannel,
    interaction: CommandInteraction,
  ) {
    await this.updateGuildSetting(
      interaction,
      "loaNotificationChannelId",
      channel.id,
      `✅ LOA notification channel set to: <#${channel.id}>`,
      "Error setting LOA notification channel",
      "❌ Failed to set LOA notification channel. Please try again.",
      "settings-loa-notification-channel",
      channel.id,
    );
  }

  @Slash({
    name: "cooldown-days",
    description: "Set the cooldown period (in days) after ending an LOA early",
  })
  async setCooldownDays(
    @SlashOption({
      name: "days",
      description: "Number of days for the cooldown period (default: 14)",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      minValue: 1,
      maxValue: 365,
    })
    days: number,
    interaction: CommandInteraction,
  ) {
    await this.updateGuildSetting(
      interaction,
      "leaveOfAbsenceCooldownDays",
      days,
      `✅ LOA cooldown period set to ${days} day${days !== 1 ? "s" : ""}.`,
      "Error setting LOA cooldown days",
      "❌ Failed to set LOA cooldown period. Please try again.",
      "settings-loa-cooldown-days",
      String(days),
    );
  }

  @Slash({
    name: "minimum-request-time",
    description: "Set the minimum LOA duration (in days) that users can request",
  })
  async setMinimumRequestTime(
    @SlashOption({
      name: "days",
      description: "Minimum number of days for LOA requests (default: 30)",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      minValue: 1,
      maxValue: 365,
    })
    days: number,
    interaction: CommandInteraction,
  ) {
    await this.updateGuildSetting(
      interaction,
      "minimumRequestTimeDays",
      days,
      `✅ Minimum LOA request time set to ${days} day${days !== 1 ? "s" : ""}.`,
      "Error setting minimum LOA request time",
      "❌ Failed to set minimum LOA request time. Please try again.",
      "settings-loa-minimum-request-time",
      String(days),
    );
  }
}
