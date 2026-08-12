import { Discord, Slash, SlashGroup } from "discordx";
import {
  CommandInteraction,
  EmbedBuilder,
  Colors,
  MessageFlags,
} from "discord.js";
import { prisma } from "../../../main.js";
import { groupRoleSyncManager } from "../../../managers/groupRoleSync/groupRoleSyncManager.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
@SlashGroup({ name: "group", description: "VRChat group commands" })
@SlashGroup("group")
export class GroupSelfRoleSyncCommand {
  @Slash({
    name: "sync-me",
    description: "Sync your Discord roles to your VRChat group roles",
  })
  async selfRoleSync(interaction: CommandInteraction): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Get the VRChat group ID from guild settings
      const guildSettings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      if (!guildSettings?.vrcGroupId) {
        await interaction.editReply({
          content: "❌ No VRChat group configured for this server.",
        });
        return;
      }

      // Get user's verified VRChat account
      const user = await prisma.user.findUnique({
        where: { discordId: interaction.user.id },
        include: {
          vrchatAccounts: {
            where: { accountType: { in: ["MAIN", "ALT"] } },
          },
        },
      });

      if (!user || user.vrchatAccounts.length === 0) {
        await interaction.editReply({
          content:
            "❌ You don't have a verified VRChat account. Please verify your account first using `/verify account`.",
        });
        return;
      }

      // Use the main account if available, otherwise first verified account
      const mainAccount = user.vrchatAccounts.find(
        (acc: { accountType: string }) => acc.accountType === "MAIN",
      );
      const vrcAccount = mainAccount || user.vrchatAccounts[0];

      // Sync roles
      const result = await groupRoleSyncManager.syncUserRoles(
        interaction.guildId,
        interaction.user.id,
        vrcAccount.vrcUserId,
      );

      if (result.success) {
        const embed = new EmbedBuilder()
          .setTitle("✅ Roles Synced!")
          .setDescription(
            `Your VRChat group roles have been synchronized with your Discord roles.\n\n**Account:** ${vrcAccount.vrchatUsername || vrcAccount.vrcUserId}`,
          )
          .setColor(Colors.Green)
          .setFooter({ text: "S.H.I.E.L.D. Bot - Group Role Sync" })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else {
        // Build error message based on error type
        let errorMessage = "";

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
              errorMessage = `❌ **Not a Group Member**\n\n${result.reason}\n\nPlease join the VRChat group first using \`/group join\`, then try syncing your roles again.`;
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
          .setTitle("❌ Role Sync Failed")
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

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error: unknown) {
      loggers.vrchat.error("Self Role Sync error", error);

      const embed = new EmbedBuilder()
        .setTitle("❌ Role Sync Failed")
        .setDescription("An unexpected error occurred. Please contact the development team.")
        .setColor(Colors.Red)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Role Sync" });

      await interaction.editReply({ embeds: [embed] });
    }
  }
}
