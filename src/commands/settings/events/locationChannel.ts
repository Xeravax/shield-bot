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
export class SettingsEventsLocationChannelCommand {
  @Slash({
    name: "location-channel",
    description:
      "Set the voice channel name used as location in calendar feeds (Discord events always use External VRChat)",
  })
  async locationChannel(
    @SlashOption({
      name: "channel",
      description: "Voice channel name shown in calendar feed location",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildVoice],
      required: false,
    })
    channel: GuildBasedChannel | null,
    @SlashOption({
      name: "clear",
      description: "Clear the calendar feed location channel",
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
        const channelId = settings?.eventLocationChannelId;

        if (!channelId) {
          await interaction.reply({
            content:
              "ℹ️ No calendar feed location channel is set. Discord scheduled events always use External **VRChat**.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          content:
            `ℹ️ Calendar feed location channel is <#${channelId}>.\n` +
            `Discord scheduled events always use External **VRChat**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const channelId: string | null = shouldClear ? null : channel ? channel.id : null;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: { eventLocationChannelId: channelId },
        create: {
          guildId: interaction.guildId,
          eventLocationChannelId: channelId,
        },
      });

      try {
        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "settings-events-location-channel",
          interaction.user.id,
          undefined,
          channelId ?? undefined,
        );
      } catch (logError) {
        loggers.bot.warn("Failed to log location-channel usage", logError);
      }

      await interaction.editReply({
        content: shouldClear
          ? "✅ Cleared calendar feed location channel. Discord scheduled events still use External **VRChat**."
          : `✅ Calendar feed location channel set to <#${channelId}>. Discord scheduled events still use External **VRChat**.`,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error setting event location channel", error);
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