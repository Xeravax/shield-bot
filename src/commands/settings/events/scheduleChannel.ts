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
export class SettingsEventsScheduleChannelCommand {
  @Slash({
    name: "schedule-channel",
    description: "Set the legacy on-duty schedule channel (use on-duty-schedule-channel instead)",
  })
  async scheduleChannel(
    @SlashOption({
      name: "channel",
      description: "The channel for the exported weekly event schedule",
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

        if (!settings?.eventScheduleChannelId) {
          await interaction.reply({
            content: "ℹ️ No event schedule channel is currently configured.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          content: `ℹ️ Event schedule channel is set to <#${settings.eventScheduleChannelId}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: {
          eventScheduleChannelId: channel.id,
        },
        create: {
          guildId: interaction.guildId,
          eventScheduleChannelId: channel.id,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-events-schedule-channel",
        interaction.user.id,
        undefined,
        channel.id,
      );

      await interaction.reply({
        content: `✅ Legacy event schedule channel set to <#${channel.id}>. The on-duty schedule channel is unchanged — use \`/settings events on-duty-schedule-channel\` to configure it.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error setting event schedule channel", error);
      await interaction.reply({
        content: `❌ Failed to set channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
