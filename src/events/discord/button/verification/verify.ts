import {
  ButtonInteraction,
  MessageFlags,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { Discord, ButtonComponent } from "discordx";
import { prisma } from "../../../../main.js";
import { ButtonBuilder } from "discord.js";
import { getUserById, isValidVRChatUserId } from "../../../../utility/vrchat.js";
import { loggers } from "../../../../utility/logger.js";
@Discord()
export class VRChatVerifyButtonHandler {
  @ButtonComponent({
    id: /vrchat-verify:(\d+):([a-zA-Z0-9\-_]+)/,
  })
  async handleConfirm(interaction: ButtonInteraction) {
    const parts = interaction.customId.split(":");
    const discordId = parts[1];
    const vrcUserId = parts[2];

    if (!discordId || !vrcUserId) {
      await interaction.reply({
        content:
          "Could not determine Discord or VRChat user ID from the button.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Validate VRChat user ID format
    if (!isValidVRChatUserId(vrcUserId)) {
      loggers.bot.error(
        `Invalid VRChat user ID format in handleConfirm: "${vrcUserId}". Expected format: "usr_...".`,
      );
      await interaction.reply({
        content:
          "❌ Invalid VRChat user ID format. Please contact support if this error persists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Ensure user exists in database
    let user = await prisma.user.findUnique({ where: { discordId } });
    if (!user) {
      user = await prisma.user.create({ data: { discordId } });
    }

    const vrcAccount = await prisma.vRChatAccount.findFirst({
      where: { vrcUserId },
    });
    const isFullyVerified =
      vrcAccount?.accountType === "MAIN" || vrcAccount?.accountType === "ALT";

    // Block verification if account is fully verified by someone else
    if (vrcAccount && vrcAccount.userId !== user.id && isFullyVerified) {
      await interaction.reply({
        content:
          "❌ This VRChat account is fully verified and protected from takeover. Please contact the current owner or use a different account.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Block re-verification if account is already fully verified for this user
    if (vrcAccount && vrcAccount.userId === user.id && isFullyVerified) {
      const embed = new EmbedBuilder()
        .setTitle("Already Verified")
        .setDescription(
          "This VRChat account is already fully verified. Please contact staff if you need further assistance.",
        )
        .setColor(0xed4245);

      await interaction.update({
        embeds: [embed],
        components: [],
      });
      return;
    }

    // Get VRChat username for caching
    const vrchatUsername = await this.getVRChatUsername(vrcUserId);

    // Create or update account for verification
    if (!vrcAccount) {
      await prisma.vRChatAccount.create({
        data: {
          vrcUserId,
          userId: user.id,
          accountType: "IN_VERIFICATION",
          verificationGuildId: interaction.guildId || undefined,
          vrchatUsername,
          usernameUpdatedAt: new Date(),
        },
      });
    } else {
      await prisma.vRChatAccount.update({
        where: { id: vrcAccount.id },
        data: {
          userId: user.id,
          accountType: "IN_VERIFICATION",
          verificationGuildId: interaction.guildId || undefined,
          vrchatUsername,
          usernameUpdatedAt: new Date(),
        },
      });
    }

    // Show verification method selection
    await this.showVerificationMethods(interaction, discordId, vrcUserId);
  }

  @ButtonComponent({ id: "vrchat-verify-try-again" })
  async handleTryAgain(interaction: ButtonInteraction) {
    await interaction.update({
      content:
        "❌ Verification cancelled. Please use `/vrchat verify` again to restart the process.",
    });
  }

  private async getVRChatUsername(vrcUserId: string): Promise<string | null> {
    try {
      const userInfo = await getUserById(vrcUserId);
      const userTyped = userInfo as { displayName?: string; username?: string } | null;
      return userTyped?.displayName || userTyped?.username || null;
    } catch (error) {
      loggers.vrchat.warn(`Failed to fetch username for ${vrcUserId}`, error);
      return null;
    }
  }

  private async showVerificationMethods(
    interaction: ButtonInteraction,
    discordId: string,
    vrcUserId: string,
  ): Promise<void> {
    const verifyEmbed = new EmbedBuilder()
      .setTitle("How would you like to verify?")
      .setDescription("Choose a verification method:")
      .setColor(0x5865f2)
      .addFields(
        {
          name: "Friend request :busts_in_silhouette:",
          value:
            "Send a friend request to your VRChat account and verify when accepted.",
          inline: false,
        },
        {
          name: "Change status",
          value: "Change your VRChat status to a special code to verify.",
          inline: false,
        },
      );

    const friendBtn = new ButtonBuilder()
      .setCustomId(`vrchat-friend:${discordId}:${vrcUserId}`)
      .setLabel("Friend request")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("👥");

    const statusBtn = new ButtonBuilder()
      .setCustomId(`vrchat-status:${discordId}:${vrcUserId}`)
      .setLabel("Change status")
      .setStyle(ButtonStyle.Secondary);

    await interaction.update({
      embeds: [verifyEmbed],
      components: [{ type: 1, components: [friendBtn, statusBtn] }],
    });
  }
}
