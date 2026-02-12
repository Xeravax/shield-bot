import {
  ButtonInteraction,
  MessageFlags,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { Discord, ButtonComponent } from "discordx";
import { ButtonBuilder } from "discord.js";
import {
  sendFriendRequest,
  unfriendUser,
  getUserById,
} from "../../../../../utility/vrchat.js";
import { prisma } from "../../../../../main.js";
import { VerificationInteractionManager } from "../../../../../managers/verification/verificationInteractionManager.js";
import { loggers } from "../../../../../utility/logger.js";

@Discord()
export class VRChatFriendVerifyButtonHandler {
  @ButtonComponent({ id: /vrchat-friend:(\d+):([a-zA-Z0-9\-_]+)/ })
  async handleFriendRequest(interaction: ButtonInteraction) {
    const parts = interaction.customId.split(":");
    const discordId = parts[1];
    const vrcUserId = parts[2];

    // Backend logic to send friend request
    let friendRequestSent = false;
    let errorMsg = "";
    try {
      await sendFriendRequest(vrcUserId);
      friendRequestSent = true;
    } catch (err: unknown) {
      if (err instanceof Error && err.message && err.message.includes("400")) {
        // Already friends, unfriend and try again
        try {
          await unfriendUser(vrcUserId);
          await sendFriendRequest(vrcUserId);
          friendRequestSent = true;
        } catch (_err2: unknown) {
          errorMsg = _err2 instanceof Error ? _err2.message : "Failed to unfriend and re-friend user.";
        }
      } else {
        errorMsg = err instanceof Error ? err.message : "Failed to send friend request.";
      }
    }
    let embed;
    if (friendRequestSent) {
      embed = new EmbedBuilder()
        .setTitle("Friend Request Sent")
        .setDescription(
          `A friend request has been sent to your VRChat account (**${vrcUserId}**).\n\nOnce you accept the friend request in VRChat, click **Verify status** below or wait for automatic verification.`,
        )
        .setColor(0x57f287);
    } else {
      embed = new EmbedBuilder()
        .setTitle("Friend Request Failed")
        .setDescription(
          `Could not send a friend request to your VRChat account (**${vrcUserId}**).\n${errorMsg}`,
        )
        .setColor(0xed4245);
    }
    const verifyBtn = new ButtonBuilder()
      .setCustomId(`vrchat-friend-verify:${discordId}:${vrcUserId}`)
      .setLabel("Verify status")
      .setStyle(ButtonStyle.Success);
    
    await interaction.update({
      embeds: [embed],
      components: [{ type: 1, components: [verifyBtn] }],
    });

    // Store the interaction for later use (valid for 15 minutes)
    if (friendRequestSent) {
      VerificationInteractionManager.storeInteraction(
        discordId,
        vrcUserId,
        interaction,
      );
    }
  }

  @ButtonComponent({ id: /vrchat-friend-verify:(\d+):([a-zA-Z0-9\-_]+)/ })
  async handleFriendVerify(interaction: ButtonInteraction) {
    const parts = interaction.customId.split(":");
    const discordId = parts[1];
    const vrcUserId = parts[2];

    // Defer reply with ephemeral flag so we can update it later
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Show initial "checking" message
    await interaction.editReply({
      content: "⏳ Checking verification status...",
    });

    // Check if the user has been verified in the database
    const vrcAccount = await prisma.vRChatAccount.findFirst({
      where: {
        vrcUserId,
        user: { discordId },
        accountType: { in: ["MAIN", "ALT"] },
      },
      include: { user: true },
    });
    if (vrcAccount) {
      // Update username cache when checking verification status
      let vrchatUsername = vrcAccount.vrchatUsername;
      try {
        const userInfo = await getUserById(vrcUserId);
        const userTyped = userInfo as { displayName?: string; username?: string } | null;
        vrchatUsername = userTyped?.displayName || userTyped?.username || null;

        // Update username if it's different or if it's been more than a week
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        if (
          vrchatUsername !== vrcAccount.vrchatUsername ||
          !vrcAccount.usernameUpdatedAt ||
          vrcAccount.usernameUpdatedAt < oneWeekAgo
        ) {
          await prisma.vRChatAccount.update({
            where: { id: vrcAccount.id },
            data: {
              vrchatUsername,
              usernameUpdatedAt: new Date(),
            },
          });
        }
      } catch (e) {
        loggers.vrchat.warn(`Failed to fetch username for ${vrcUserId}`, e);
      }

      const embed = new EmbedBuilder()
        .setTitle("✅ Verification Successful")
        .setDescription(
          `Your VRChat account (**${vrchatUsername || vrcUserId}**) has been successfully verified via friend request!\n\n✅ Your account is now fully verified and protected from takeover.`,
        )
        .setColor(0x57f287);
      
      // Update the ephemeral reply
      await interaction.editReply({
        embeds: [embed],
        components: [],
      });

      // Also update the original message that had the "Verify status" button
      try {
        if (interaction.message && interaction.message.editable) {
          await interaction.message.edit({
            embeds: [embed],
            components: [],
          });
        }
      } catch (error: unknown) {
        const code = (error as { code?: number; rawError?: { code?: number } })?.code
          ?? (error as { code?: number; rawError?: { code?: number } })?.rawError?.code;
        if (code !== 10008) {
          loggers.vrchat.warn(`Failed to update original message`, error);
        }
      }
    } else {
      const embed = new EmbedBuilder()
        .setTitle("❌ Not Verified Yet")
        .setDescription(
          `You are not verified yet. Please make sure you have accepted the friend request from the bot in VRChat, then press **Verify status** again.`,
        )
        .setColor(0xed4245);
      const verifyBtn = new ButtonBuilder()
        .setCustomId(`vrchat-friend-verify:${discordId}:${vrcUserId}`)
        .setLabel("Verify status")
        .setStyle(ButtonStyle.Success);
      await interaction.editReply({
        embeds: [embed],
        components: [{ type: 1, components: [verifyBtn] }],
      });
    }
  }
}
