import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  EmbedBuilder,
  Colors,
  User,
  MessageFlags,
} from "discord.js";
import { StaffGuard } from "../../../utility/guards.js";
import { patrolTimer, prisma } from "../../../main.js";
import { groupRoleSyncManager } from "../../../managers/groupRoleSync/groupRoleSyncManager.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
@SlashGroup({ name: "group", description: "VRChat group management" })
@SlashGroup("group")
@Guard(StaffGuard)
export class GroupRoleSyncCommand {
  @Slash({
    name: "rolesync",
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
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Check if VRChat group is configured
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      if (!settings?.vrcGroupId) {
        await interaction.editReply({
          content:
            "❌ No VRChat group ID configured. Please set it first using `/settings group set-group-id`.",
        });
        return;
      }

      // Check if user has any verified VRChat accounts
      const discordUser = await prisma.user.findUnique({
        where: { discordId: user.id },
        include: {
          vrchatAccounts: {
            where: {
              accountType: { in: ["MAIN", "ALT"] },
            },
          },
        },
      });

      if (!discordUser || discordUser.vrchatAccounts.length === 0) {
        await interaction.editReply({
          content: `❌ ${user.username} does not have any verified VRChat accounts.`,
        });
        return;
      }

      // Check if there are any role mappings configured
      const mappingsCount = await prisma.groupRoleMapping.count({
        where: { guildId: interaction.guildId },
      });

      if (mappingsCount === 0) {
        await interaction.editReply({
          content:
            "❌ No role mappings configured. Please configure role mappings using `/group role map`.",
        });
        return;
      }

      // Attempt to sync for each verified account
      const syncedAccounts: Array<{
        username: string;
        userId: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const vrcAccount of discordUser.vrchatAccounts) {
        const result = await groupRoleSyncManager.syncUserRoles(
          interaction.guildId,
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
        interaction.guildId,
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
