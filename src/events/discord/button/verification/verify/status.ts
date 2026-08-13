import {
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  ButtonBuilder,
  MessageFlags,
} from "discord.js";
import { Discord, ButtonComponent } from "discordx";
import { prisma } from "../../../../../main.js";
import { getUserById } from "../../../../../utility/vrchat.js";
import { VerificationInteractionManager } from "../../../../../managers/verification/verificationInteractionManager.js";
import { loggers } from "../../../../../utility/logger.js";
import { DiscordColors } from "../../../../../config/constants.js";

@Discord()
export class VRChatStatusVerifyButtonHandler {
  @ButtonComponent({ id: /vrchat-status:(\d+):([a-zA-Z0-9\-_]+)/ })
  async handleStatusMethod(interaction: ButtonInteraction) {
    const parts = interaction.customId.split(":");
    const discordId = parts[1];
    const vrcUserId = parts[2];

    // Generate and store a unique verification code for this user in the database
    const verificationCode = Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase();
    await prisma.vRChatAccount.updateMany({
      where: { vrcUserId },
      data: { verificationCode },
    });
    const embed = new EmbedBuilder()
      .setTitle("Change Status to Verify")
      .setDescription(
        `To verify, change your VRChat status to the following code:\n\n**${verificationCode}**\n\nOnce you've changed your status, click **Verify status** below.`,
      )
      .setColor(DiscordColors.WARNING);
    const verifyBtn = new ButtonBuilder()
      .setCustomId(`vrchat-status-verify:${discordId}:${vrcUserId}`)
      .setLabel("Verify status")
      .setStyle(ButtonStyle.Success);

    await interaction.update({
      embeds: [embed],
      components: [{ type: 1, components: [verifyBtn] }],
    });

    // Store the interaction for later use (valid for 15 minutes)
    VerificationInteractionManager.storeInteraction(
      discordId,
      vrcUserId,
      interaction,
    );
  }

  @ButtonComponent({ id: /vrchat-status-verify:(\d+):([a-zA-Z0-9\-_]+)/ })
  async handleStatusVerify(interaction: ButtonInteraction) {
    const parts = interaction.customId.split(":");
    const discordId = parts[1];
    const vrcUserId = parts[2];

    // Defer reply with ephemeral flag so we can update it later
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Show initial "checking" message
    await interaction.editReply({
      content: "⏳ Checking verification status...",
    });

    // Fetch the VRChatAccount to get the verification code, ensure it's linked to this Discord user
    const vrcAccount = await prisma.vRChatAccount.findFirst({
      where: {
        vrcUserId,
        user: { discordId },
      },
      include: { user: true },
    });
    if (!vrcAccount || !vrcAccount.verificationCode) {
      const embed = new EmbedBuilder()
        .setTitle("❌ Verification Error")
        .setDescription(
          "No verification code found for this account, or this account is not linked to your Discord user. Please restart the verification process.",
        )
        .setColor(DiscordColors.ERROR);
      await interaction.editReply({
        embeds: [embed],
        components: [],
      });
      return;
    }
    // Fetch the VRChat user info
    const userInfo = await getUserById(vrcUserId).catch((e) => {
      loggers.vrchat.error("Failed to fetch user info for verification", e, {
        vrcUserId,
      });
      return null;
    });
    const userTyped = userInfo as { statusDescription?: string } | null;
    if (!userTyped || !userTyped.statusDescription) {
      const embed = new EmbedBuilder()
        .setTitle("❌ Status Fetch Error")
        .setDescription(
          "Could not fetch VRChat user status. Please try again later.",
        )
        .setColor(DiscordColors.ERROR);
      await interaction.editReply({
        embeds: [embed],
        components: [],
      });
      return;
    }
    // Check if the statusDescription contains the verification code
    if (userTyped.statusDescription.includes(vrcAccount.verificationCode)) {
      // Update username cache and promote from IN_VERIFICATION to MAIN/ALT
      const vrchatUsername = (userTyped as { displayName?: string; username?: string }).displayName || (userTyped as { displayName?: string; username?: string }).username;

      // Determine final account type based on whether user has a MAIN account
      const hasMainAccount = await prisma.vRChatAccount.findFirst({
        where: { userId: vrcAccount.userId, accountType: "MAIN" },
      });
      const finalAccountType = hasMainAccount ? "ALT" : "MAIN";

      await prisma.vRChatAccount.update({
        where: { id: vrcAccount.id },
        data: {
          accountType: finalAccountType,
          verificationCode: null,
          verificationGuildId: null, // Clear guild ID after verification is complete
          vrchatUsername,
          usernameUpdatedAt: new Date(),
        },
      });

      const embed = new EmbedBuilder()
        .setTitle("✅ Verification Successful")
        .setDescription(
          `Your VRChat account (**${vrchatUsername || vrcUserId}**) has been successfully verified via status change!\n\n✅ Your account is now fully verified and protected from takeover.`,
        )
        .setColor(DiscordColors.SUCCESS);

      // Update the ephemeral reply
      await interaction.editReply({
        embeds: [embed],
        components: [],
      });

      // Also update the original message that had the "Verify status" button
      // Try stored interaction first, then fallback to message editing
      const discordId = interaction.user.id;
      const storedInteraction = VerificationInteractionManager.getInteraction(discordId, vrcUserId);
      
      if (storedInteraction) {
        try {
          await storedInteraction.editReply({
            embeds: [embed],
            components: [],
          });
          VerificationInteractionManager.removeInteraction(discordId, vrcUserId);
        } catch (error) {
          loggers.vrchat.warn("Failed to update via stored interaction", error);
          // Fall through to message editing
        }
      }

      // Fallback: try to edit the original message directly
      try {
        if (interaction.message && interaction.message.editable) {
          await interaction.message.edit({
            embeds: [embed],
            components: [],
          });
        }
      } catch (error) {
        loggers.vrchat.warn("Failed to update original message", error);
      }
    } else {
      const embed = new EmbedBuilder()
        .setTitle("❌ Verification Failed")
        .setDescription(
          "Verification failed. The code was not found in your VRChat status. Please make sure you have set your status correctly and try again.",
        )
        .setColor(DiscordColors.ERROR);
      const verifyBtn = new ButtonBuilder()
        .setCustomId(`vrchat-status-verify:${discordId}:${vrcUserId}`)
        .setLabel("Verify status")
        .setStyle(ButtonStyle.Success);
      await interaction.editReply({
        embeds: [embed],
        components: [{ type: 1, components: [verifyBtn] }],
      });
    }
  }
}
