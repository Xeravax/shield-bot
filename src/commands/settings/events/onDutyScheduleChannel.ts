import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  ChannelType,
  CommandInteraction,
  GuildBasedChannel,
  MessageFlags,
} from "discord.js";
import { PermissionNodeGuard } from "../../../utility/permissionNodes.js";
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

      if (!channel) {
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

      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: { eventOnDutyScheduleChannelId: channel.id },
        create: {
          guildId: interaction.guildId,
          eventOnDutyScheduleChannelId: channel.id,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-events-on-duty-schedule-channel",
        interaction.user.id,
        undefined,
        channel.id,
      );

      await interaction.reply({
        content: `✅ On-duty schedule channel set to <#${channel.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error setting on-duty schedule channel", error);
      await interaction.reply({
        content: `❌ Failed to set channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
