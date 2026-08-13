import {
  ButtonInteraction,
  MessageFlags,
  EmbedBuilder,
  Colors,
} from "discord.js";
import { Discord, ButtonComponent } from "discordx";
import { prisma } from "../../../../main.js";
import { groupRoleSyncManager } from "../../../../managers/groupRoleSync/groupRoleSyncManager.js";
import { loggers } from "../../../../utility/logger.js";

@Discord()
export class VRChatGroupRoleSyncButtonHandler {
  @ButtonComponent({ id: /grp-sync:(\d+):([a-zA-Z0-9\-_]+)/ })
  async handleGroupRoleSync(interaction: ButtonInteraction) {
    const parts = interaction.customId.split(":");
    const discordId = parts[1];
    const vrcUserId = parts[2];

    // Verify this is the correct user
    if (interaction.user.id !== discordId) {
      await interaction.reply({
        content: "❌ This button is not for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Verify the account is verified and belongs to this user
    const vrcAccount = await prisma.vRChatAccount.findFirst({
      where: {
        vrcUserId,
        user: { discordId },
        accountType: { in: ["MAIN", "ALT"] },
      },
    });

    if (!vrcAccount) {
      await interaction.reply({
        content:
          "❌ VRChat account not found or not verified. Please verify your account first using `/verify account`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get the guild ID from settings
    const guildSettings = await prisma.guildSettings.findFirst({
      where: { vrcGroupId: { not: null } },
    });

    if (!guildSettings?.vrcGroupId) {
      await interaction.reply({
        content: "❌ No VRChat group configured.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Sync roles
    const result = await groupRoleSyncManager.syncUserRoles(
      guildSettings.guildId,
      discordId,
      vrcUserId,
    );

    if (result.success) {
      const embed = new EmbedBuilder()
        .setTitle("✅ Roles Synced!")
        .setDescription(
          `Your VRChat group roles have been synchronized with your Discord roles.\n\n**Account:** ${vrcAccount.vrchatUsername || vrcUserId}`,
        )
        .setColor(Colors.Green)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Role Sync" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } else {
      // Build error message based on error type
      let errorMessage: string;
      const title = "❌ Role Sync Failed";

      switch (result.errorType) {
        case "permission":
          if (result.reason.includes("cannot manage") || result.reason.includes("higher than the bot")) {
            errorMessage = `❌ **Insufficient Permissions**\n\n${result.reason}\n\nThis is expected for members with high-ranking roles. If you believe this is an error, please contact the development team.`;
          } else {
            errorMessage = `❌ **Permission Error**\n\n${result.reason}\n\nIf you believe this is an error, please contact the development team.`;
          }
          break;
        case "validation":
          if (result.reason.includes("not a member") || result.reason.includes("join the group")) {
            errorMessage = `❌ **Not a Group Member**\n\n${result.reason}\n\nPlease join the VRChat group first, then try syncing your roles again.`;
          } else if (result.reason.includes("failed to fetch")) {
            errorMessage = `❌ **Fetch Failed**\n\n${result.reason}\n\nPlease try again later. If this issue persists, contact the development team.`;
          } else {
            errorMessage = `❌ **Validation Error**\n\n${result.reason}\n\nPlease verify your account status and try again.`;
          }
          break;
        case "api":
          errorMessage = `❌ **Role Update Failed**\n\n${result.reason}\n\nPlease contact the development team for assistance.`;
          break;
        case "unknown":
        default:
          errorMessage = `❌ **Sync Failed**\n\n**Reason:** ${result.reason}\n\nPlease contact the development team for assistance.`;
          break;
      }

      // Build the error embed
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(errorMessage)
        .setColor(Colors.Red)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Role Sync" });

      // Add contact instructions if needed
      if (result.requiresDevContact) {
        embed.addFields({
          name: "Need Help?",
          value: "If this issue persists, please contact the development team with the error details above.",
          inline: false,
        });
      }

      try {
        await interaction.editReply({ embeds: [embed] });
      } catch (replyError) {
        loggers.vrchat.error("Failed to send error response to user", replyError);
      }
    }
  }
}
