import { Discord, Slash, SlashOption, Guard, SlashGroup } from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  MessageFlags,
  GuildBasedChannel,
} from "discord.js";
import { PermissionNodeGuard } from "../../../utility/permissionNodes.js";
import { prisma } from "../../../main.js";

@Discord()
@SlashGroup({
  description: "Attendance settings",
  name: "attendance",
  root: "settings",
})
@SlashGroup("attendance", "settings")
@Guard(PermissionNodeGuard("settings.command.attendance"))
export class SettingsAttendanceSubGroup {
  @Slash({
    name: "add-channel",
    description: "Add a channel to the enrolled channels for attendance.",
  })
  async addChannel(
    @SlashOption({
      name: "channel",
      description: "Channel to add",
      type: ApplicationCommandOptionType.Channel,
      required: true,
    })
    channel: GuildBasedChannel,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;

    // Fetch the current guild settings
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId },
    });

    if (!settings) {
      await interaction.reply({
        content: "No settings found for this server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const enrolledChannels = (settings.enrolledChannels as string[]) || [];

    if (enrolledChannels.includes(channel.id)) {
      await interaction.reply({
        content: `The channel <#${channel.id}> is already enrolled.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Add the channel to the enrolledChannels array
    enrolledChannels.push(channel.id);

    // Update the database
    await prisma.guildSettings.update({
      where: { guildId },
      data: { enrolledChannels },
    });

    await interaction.reply({
      content: `Successfully added <#${channel.id}> to the enrolled channels.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "remove-channel",
    description: "Remove a channel from the enrolled channels for attendance.",
  })
  async removeChannel(
    @SlashOption({
      name: "channel",
      description: "Channel to remove",
      type: ApplicationCommandOptionType.Channel,
      required: true,
    })
    channel: GuildBasedChannel,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId;
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId },
    });

    if (!settings) {
      await interaction.reply({
        content: "No settings found for this server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const enrolledChannels = (settings.enrolledChannels as string[]) || [];

    if (!enrolledChannels.includes(channel.id)) {
      await interaction.reply({
        content: `The channel <#${channel.id}> is not enrolled.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updatedChannels = enrolledChannels.filter((id) => id !== channel.id);
    await prisma.guildSettings.update({
      where: { guildId },
      data: { enrolledChannels: updatedChannels },
    });

    await interaction.reply({
      content: `Successfully removed <#${channel.id}> from the enrolled channels.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
