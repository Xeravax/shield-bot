import { Discord, Guard, Slash, SlashGroup } from "discordx";
import {
  CommandInteraction,
  EmbedBuilder,
  Colors,
  MessageFlags,
  Client,
} from "discord.js";
import { groupRoleSyncManager } from "../../../managers/groupRoleSync/groupRoleSyncManager.js";
import { loggers } from "../../../utility/logger.js";
import {
  GuildGuard,
  VerifiedAccountGuard,
  VrchatGroupConfiguredGuard,
  VrchatRoleMappingsGuard,
} from "../../../utility/guards.js";
import {
  type AppGuardData,
  requireGuardVerifiedAccount,
} from "../../../utility/guardData.js";

@Discord()
@SlashGroup({ name: "group", description: "VRChat group commands" })
@SlashGroup("group")
export class GroupSelfRoleSyncCommand {
  @Slash({
    name: "sync-me",
    description: "Sync your Discord roles to your VRChat group roles",
  })
  @Guard(
    GuildGuard,
    VerifiedAccountGuard(),
    VrchatGroupConfiguredGuard,
    VrchatRoleMappingsGuard,
  )
  async selfRoleSync(
    interaction: CommandInteraction,
    _client: Client,
    guardData: AppGuardData,
  ): Promise<void> {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // GuildGuard ensures guildId is present
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const guildId = interaction.guildId!;
      const vrcAccount = requireGuardVerifiedAccount(guardData);

      const result = await groupRoleSyncManager.syncUserRoles(
        guildId,
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
