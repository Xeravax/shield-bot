import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  ChannelType,
  CommandInteraction,
  GuildBasedChannel,
  MessageFlags,
} from "discord.js";
import { PermissionNodeGuard } from "../../../utility/guards.js";
import { patrolTimer, prisma } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
@SlashGroup("events", "settings")
@Guard(PermissionNodeGuard("settings.command.events"))
export class SettingsEventsOnDutyScheduleChannelCommand {
  @Slash({
    name: "on-duty-schedule-channel",
    description: "Set the channel where exported on-duty weekly schedules are posted",
  })
  async onDutyScheduleChannel(
    @SlashOption({
      name: "channel",
      description: "The on-duty weekly schedule channel",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      required: false,
    })
    channel: GuildBasedChannel | null,
    @SlashOption({
      name: "clear",
      description: "Clear on-duty override and fall back to legacy schedule channel",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clear: boolean | null,
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
        });
        const channelId =
          settings?.eventOnDutyScheduleChannelId ?? settings?.eventScheduleChannelId;

        if (!channelId) {
          await interaction.reply({
            content: "ℹ️ No on-duty schedule channel is currently configured.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          content: `ℹ️ On-duty schedule channel is set to <#${channelId}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const channelId: string | null = shouldClear ? null : channel ? channel.id : null;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: { eventOnDutyScheduleChannelId: channelId },
        create: {
          guildId: interaction.guildId,
          eventOnDutyScheduleChannelId: channelId,
        },
      });

      try {
        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "settings-events-on-duty-schedule-channel",
          interaction.user.id,
          undefined,
          channelId ?? undefined,
        );
      } catch (logError) {
        loggers.bot.warn("Failed to log on-duty-schedule-channel usage", logError);
      }

      await interaction.editReply({
        content: shouldClear
          ? "✅ Cleared on-duty schedule channel override. Exports will now use the legacy schedule channel."
          : `✅ On-duty schedule channel set to <#${channelId}>.`,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error setting on-duty schedule channel", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: `❌ Failed to set channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      } else {
        await interaction.reply({
          content: `❌ Failed to set channel: ${error instanceof Error ? error.message : "Unknown error"}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
}
