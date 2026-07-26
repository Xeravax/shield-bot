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
export class SettingsEventsOffDutyScheduleChannelCommand {
  @Slash({
    name: "off-duty-schedule-channel",
    description: "Set the channel where exported off-duty weekly schedules are posted",
  })
  async offDutyScheduleChannel(
    @SlashOption({
      name: "channel",
      description: "The off-duty weekly schedule channel",
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

        if (!settings?.eventOffDutyScheduleChannelId) {
          await interaction.reply({
            content: "ℹ️ No off-duty schedule channel is currently configured.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          content: `ℹ️ Off-duty schedule channel is set to <#${settings.eventOffDutyScheduleChannelId}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: { eventOffDutyScheduleChannelId: channel.id },
        create: {
          guildId: interaction.guildId,
          eventOffDutyScheduleChannelId: channel.id,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-events-off-duty-schedule-channel",
        interaction.user.id,
        undefined,
        channel.id,
      );

      await interaction.reply({
        content: `✅ Off-duty schedule channel set to <#${channel.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error setting off-duty schedule channel", error);
      await interaction.reply({
        content: `❌ Failed to set channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
