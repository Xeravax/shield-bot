import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  EmbedBuilder,
  Colors,
  User,
  MessageFlags,
} from "discord.js";
import {
  GuildGuard,
  VrchatGroupConfiguredGuard,
  VrchatRoleMappingsGuard,
} from "../../../utility/guards.js";
import { PermissionNodeGuard } from "../../../utility/permissionNodes.js";
import { patrolTimer } from "../../../main.js";
import { groupRoleSyncManager } from "../../../managers/groupRoleSync/groupRoleSyncManager.js";
import { loggers } from "../../../utility/logger.js";
import { requireVerifiedAccounts } from "../../../utility/verification/requireVerifiedAccount.js";

@Discord()
@SlashGroup({ name: "group", description: "VRChat group management" })
@SlashGroup("group")
@Guard(
  GuildGuard,
  PermissionNodeGuard("vrchat.command.rolesync"),
  VrchatGroupConfiguredGuard,
  VrchatRoleMappingsGuard,
)
export class GroupRoleSyncCommand {
  @Slash({
    name: "role-sync",
    description: "Manually sync a user's Discord roles to their VRChat group roles",
  })
  async syncRoles(
    @SlashOption({
      name: "user",
      description: "Discord user to sync roles for",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // GuildGuard ensures guildId is present
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const guildId = interaction.guildId!;

      const accountsResult = await requireVerifiedAccounts(user.id);
      if (!accountsResult.ok) {
        await interaction.editReply({
          content: accountsResult.message,
        });
        return;
      }

      const syncedAccounts: Array<{
        username: string;
        userId: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const vrcAccount of accountsResult.value) {
        const result = await groupRoleSyncManager.syncUserRoles(
          guildId,
          user.id,
          vrcAccount.vrcUserId,
        );
        
        if (result.success) {
          syncedAccounts.push({
            username: vrcAccount.vrchatUsername || "Unknown",
            userId: vrcAccount.vrcUserId,
            success: true,
          });
        } else {
          syncedAccounts.push({
            username: vrcAccount.vrchatUsername || "Unknown",
            userId: vrcAccount.vrcUserId,
            success: false,
            error: result.reason,
          });
        }
      }

      const successCount = syncedAccounts.filter((a) => a.success).length;
      await patrolTimer.logCommandUsage(
        guildId,
        "settings-group-role-sync",
        interaction.user.id,
        user.id,
        `${successCount}/${syncedAccounts.length} account(s)`,
      );

      const hasErrors = syncedAccounts.some((a) => !a.success);
      const accountsList = syncedAccounts
        .map((acc) => {
          const link = `[${acc.username}](https://vrchat.com/home/user/${acc.userId})`;
          if (acc.success) {
            return `✅ ${link}`;
          } else {
            return `❌ ${link}\n   └ Error: ${acc.error}`;
          }
        })
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("🔄 VRChat Role Sync Results")
        .setDescription(
          `Synced Discord roles to VRChat group roles for ${user.tag}`,
        )
        .addFields(
          {
            name: "Discord Member",
            value: `<@${user.id}>`,
            inline: true,
          },
          {
            name: "Accounts Synced",
            value: `${syncedAccounts.filter((a) => a.success).length}/${syncedAccounts.length}`,
            inline: true,
          },
          {
            name: "VRChat Accounts",
            value: accountsList,
            inline: false,
          },
        )
        .setColor(hasErrors ? Colors.Orange : Colors.Green)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Role Sync" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error: unknown) {
      loggers.vrchat.error("Error syncing roles", error);
      await interaction.editReply({
        content: `❌ Failed to sync roles: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }
}
