import {
  ButtonInteraction,
  MessageFlags,
  EmbedBuilder,
  Colors,
} from "discord.js";
import { Discord, ButtonComponent } from "discordx";
import { groupRoleSyncManager } from "../../../../managers/groupRoleSync/groupRoleSyncManager.js";
import { loggers } from "../../../../utility/logger.js";
import { requireVerifiedAccounts } from "../../../../utility/verification/requireVerifiedAccount.js";
import { requireGuildVrcGroupId } from "../../../../utility/group/guildGroupConfig.js";

@Discord()
export class VRChatGroupRoleSyncButtonHandler {
  @ButtonComponent({ id: /grp-sync:(\d+):([a-zA-Z0-9\-_]+)/ })
  async handleGroupRoleSync(interaction: ButtonInteraction) {
    const match = interaction.customId.match(
      /^grp-sync:(\d+):([a-zA-Z0-9\-_]+)$/,
    );
    const discordId = match?.[1];
    const vrcUserId = match?.[2];

    if (!discordId || !vrcUserId) {
      await interaction.reply({
        content: "❌ Invalid sync button.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== discordId) {
      await interaction.reply({
        content: "❌ This button is not for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let vrcAccount;
    try {
      const accountsResult = await requireVerifiedAccounts(discordId);
      if (!accountsResult.ok) {
        await interaction.editReply({
          content:
            "❌ VRChat account not found or not verified. Please verify your account first using `/verify account`.",
        });
        return;
      }

      vrcAccount = accountsResult.value.find(
        (account) => account.vrcUserId === vrcUserId,
      );
      if (!vrcAccount) {
        await interaction.editReply({
          content:
            "❌ VRChat account not found or not verified. Please verify your account first using `/verify account`.",
        });
        return;
      }

      const groupResult = await requireGuildVrcGroupId(interaction.guildId);
      if (!groupResult.ok) {
        await interaction.editReply({
          content: groupResult.message,
        });
        return;
      }
    } catch (error: unknown) {
      loggers.vrchat.error("Error validating group role sync prerequisites", error);
      await interaction.editReply({
        content:
          "❌ Failed to validate your account or group settings. Please try again later.",
      });
      return;
    }

    const result = await groupRoleSyncManager.syncUserRoles(
      interaction.guildId,
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

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(errorMessage)
        .setColor(Colors.Red)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Role Sync" });

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
