import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  ChannelType,
  CommandInteraction,
  GuildBasedChannel,
  MessageFlags,
} from "discord.js";
import { PermissionNodeGuard } from "../../../utility/guards.js";
import {
  handleGuildSettingsError,
  readGuildSetting,
  requireGuild,
  upsertGuildSetting,
} from "./guildSettingsCommand.js";

@Discord()
@SlashGroup("events", "settings")
@Guard(PermissionNodeGuard("settings.command.events"))
export class SettingsEventsPlanningChannelCommand {
  @Slash({
    name: "planning-channel",
    description: "Set the channel where planned events await approval",
  })
  async planningChannel(
    @SlashOption({
      name: "channel",
      description: "The channel for event approval embeds",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      required: false,
    })
    channel: GuildBasedChannel | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      const guildId = await requireGuild(interaction);
      if (!guildId) {
        return;
      }

      if (!channel) {
        const channelId = await readGuildSetting(
          guildId,
          (settings) => settings?.eventPlanningChannelId ?? null,
        );

        if (!channelId) {
          await interaction.reply({
            content: "ℹ️ No event planning channel is currently configured.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          content: `ℹ️ Event planning channel is set to <#${channelId}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await upsertGuildSetting(
        guildId,
        {
          update: { eventPlanningChannelId: channel.id },
          create: {
            guildId,
            eventPlanningChannelId: channel.id,
          },
        },
        "settings-events-planning-channel",
        interaction.user.id,
        channel.id,
      );

      await interaction.reply({
        content: `✅ Event planning channel set to <#${channel.id}>. Submitted events will be posted there for approval.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      await handleGuildSettingsError(
        interaction,
        error,
        "Error setting event planning channel",
      );
    }
  }
}
