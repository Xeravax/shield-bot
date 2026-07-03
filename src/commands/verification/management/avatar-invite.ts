import {
  Discord,
  Slash,
  SlashGroup,
  Guard,
  SlashOption,
} from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
} from "discord.js";
import { VRChatLoginGuard, GuildGuard } from "../../../utility/guards.js";
import { PermissionNodeGuard } from "../../../utility/permissionNodes.js";
import { prisma } from "../../../main.js";

@Discord()
@SlashGroup({
  name: "vrchat",
  description: "VRChat related commands.",
})
@SlashGroup("vrchat")
@Guard(VRChatLoginGuard, PermissionNodeGuard("vrchat.command.avatar-invite"))
export class VRChatAvatarInviteCommand {
  @Slash({
    name: "avatar-invite",
    description: "Send a message allowing users to request an invite to an avatar world",
  })
  @Guard(GuildGuard)
  async avatarInvite(
      @SlashOption({
        name: "channel",
        description: "Channel to mention for verification instructions",
        type: ApplicationCommandOptionType.Channel,
        required: true,
      })
      channel: unknown,
    interaction: CommandInteraction,
  ) {
    await interaction.deferReply();

    // Get guild settings to retrieve the avatar world ID
    // GuildGuard ensures guildId exists
    const guildSettings = await prisma.guildSettings.findUnique({
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      where: { guildId: interaction.guildId! },
    });

    if (!guildSettings || !guildSettings.avatarWorldId) {
      await interaction.editReply({
        content:
          "❌ Avatar world ID is not configured for this server. Please contact a developer to set it up.",
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("🌍 S.H.I.E.L.D. Avatar World Access")
      .setDescription(
        `**For those who have just passed their cadet training!**\n\n` +
        `You can now access our avatar world by clicking the button below to receive an invite.\n\n` +
        `**⚠️ Important Rules:**\n` +
        `• **Never** share or invite people who are not part of S.H.I.E.L.D.\n` +
        `• **Never** give avatars away through cloning - turn cloning off!\n` +
        `• The bot will open an **Invite Only** instance, make sure your status is 🟡 so people don't try joining you and the bot can invite you.\n\n` +
        `**Requirements to use this button:**\n` +
        `• You must be verified with the bot (run \`/verify account\` in ${channel})\n` +
        `• You must be friends with the bot on VRChat`
      )
      .setColor(Colors.Blue);

    const button = new ButtonBuilder()
      .setCustomId(`avatar-invite-join:${guildSettings.avatarWorldId}`)
      .setLabel("Get Avatar World Invite")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🎭");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  }
}
