import { prisma, bot, auditLogManager } from "../../main.js";
import {
  getGroupMember,
  addRoleToGroupMember,
  removeRoleFromGroupMember,
  getGroupRoles,
} from "../../utility/vrchat/groups.js";
import { GuildMember, EmbedBuilder, Colors } from "discord.js";
import { loggers } from "../../utility/logger.js";

/**
 * Result type for role sync operations
 */
export type SyncResult = 
  | { success: true }
  | { 
      success: false; 
      reason: string; 
      requiresDevContact: boolean;
      errorType: "permission" | "validation" | "api" | "unknown";
    };

/**
 * Manager for syncing VRChat group roles to Discord roles
 */
export class GroupRoleSyncManager {
  // Cache for group roles to avoid repeated API calls
  private roleCache: Map<string, unknown[]> = new Map();

  /**
   * Get all roles for a group (with caching)
   * @param groupId VRChat group ID
   * @returns Array of role objects with id, name, order, etc.
   */
  private async getGroupRolesWithCache(groupId: string): Promise<unknown[]> {
    const cached = this.roleCache.get(groupId);
    if (cached) {
      return cached;
    }

    const roles = await getGroupRoles(groupId);
    this.roleCache.set(groupId, roles as unknown[]);

    // Clear cache after 5 minutes
    setTimeout(() => {
      this.roleCache.delete(groupId);
    }, 5 * 60 * 1000);

    return roles as unknown[];
  }

  /**
   * Get the highest role order for a member in the VRChat group
   * IMPORTANT: In VRChat groups, LOWER order values = HIGHER rank
   * (e.g., order 0 is highest, order 100 is lowest)
   * @param groupId VRChat group ID
   * @param userId VRChat user ID
   * @param managementOnly If true, only check management roles
   * @returns The lowest order value (highest rank), or Infinity if none
   */
  private async getHighestRoleOrder(
    groupId: string,
    userId: string,
    managementOnly: boolean = false,
  ): Promise<number> {
    try {
      const member = await getGroupMember(groupId, userId);
      if (!member) {
        return Infinity; // No roles = lowest possible rank
      }

      // Get the role IDs to check
      const memberTyped = member as { mRoleIds?: string[]; roleIds?: string[] };
      const roleIdsToCheck = managementOnly
        ? memberTyped.mRoleIds || []
        : [...(memberTyped.roleIds || []), ...(memberTyped.mRoleIds || [])];

      if (roleIdsToCheck.length === 0) {
        return Infinity; // No roles = lowest possible rank
      }

      // Fetch all group roles to get their order values
      const allRoles = await this.getGroupRolesWithCache(groupId);
      const roleOrderMap = new Map(
        allRoles.map((role) => {
          const roleTyped = role as { id: string; order: number };
          return [roleTyped.id, roleTyped.order];
        }),
      );

      // Find the LOWEST order (highest rank) among the member's roles
      let highestRankOrder = Infinity;
      for (const roleId of roleIdsToCheck) {
        const order = roleOrderMap.get(roleId);
        if (order !== undefined && order < highestRankOrder) {
          highestRankOrder = order;
        }
      }

      return highestRankOrder;
    } catch (error) {
      loggers.vrchat.error(
        `Error getting role order for ${userId}`,
        error,
      );
      return Infinity;
    }
  }

  /**
   * Get the highest management role order for a member in the VRChat group
   * @param groupId VRChat group ID
   * @param userId VRChat user ID
   * @returns The order of the highest management role, or -1 if none
   */
  // @ts-expect-error - Method kept for future use
  private async _getHighestManagementRoleOrder(
    groupId: string,
    userId: string,
  ): Promise<number> {
    return this.getHighestRoleOrder(groupId, userId, true);
  }

  /**
   * Check if the bot can manage a member based on role hierarchy
   * Bot can manage members if:
   * 1. Bot is in the group
   * 2. Member's highest role (any role) has a HIGHER order value than bot's highest role
   * 
   * IMPORTANT: In VRChat, LOWER order = HIGHER rank (order 0 is top, order 100 is bottom)
   * So bot can manage if: bot's order < member's order (bot is higher rank)
   * 
   * This prevents the bot from managing members who have roles above it in the hierarchy,
   * even if those roles aren't management roles (e.g., Staff role above Bot role)
   * 
   * @param groupId VRChat group ID
   * @param userId VRChat user ID to check
   * @returns True if the bot can manage this member
   */
  async canBotManageMember(
    groupId: string,
    userId: string,
  ): Promise<boolean> {
    try {
      const botVrcUserId = "usr_c3c58aa6-c4dc-4de7-80a6-6826be9327ff";

      // Get bot's highest role order (lowest number = highest rank)
      const botHighestRankOrder = await this.getHighestRoleOrder(
        groupId,
        botVrcUserId,
        false,
      );
      if (botHighestRankOrder === Infinity) {
        return false;
      }

      // Get the member's highest role order (lowest number = highest rank)
      const memberHighestRankOrder = await this.getHighestRoleOrder(
        groupId,
        userId,
        false, // Check ALL roles, not just management
      );

      // If member has no roles, bot can manage them
      if (memberHighestRankOrder === Infinity) {
        return true;
      }

      // Bot can manage if its order is LOWER (higher rank) than member's order
      // Example: Bot order 3, Member order 5 → Bot CAN manage (3 < 5)
      // Example: Bot order 3, Member order 2 → Bot CANNOT manage (3 > 2)
      return botHighestRankOrder < memberHighestRankOrder;
    } catch (error) {
      loggers.vrchat.error(
        `Error checking if bot can manage ${userId}`,
        error,
      );
      return false;
    }
  }

  /**
   * Sync a user's VRChat group roles based on their Discord roles
   * This assigns/removes VRChat group roles to match their Discord roles
   * @param guildId Discord guild ID
   * @param discordId Discord user ID
   * @param vrcUserId VRChat user ID
   * @returns SyncResult indicating success or failure with details
   */
  async syncUserRoles(
    guildId: string,
    discordId: string,
    vrcUserId: string,
  ): Promise<SyncResult> {
    try {
      // Get guild settings to find the VRChat group ID
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
      });

      if (!settings?.vrcGroupId) {
        return { success: true }; // No group configured, nothing to sync
      }

      const groupId = settings.vrcGroupId;

      // Check if bot can manage this member
      const canManage = await this.canBotManageMember(groupId, vrcUserId);
      if (!canManage) {
        return {
          success: false,
          reason: "The bot cannot manage your VRChat group roles because your VRChat role is equal to or higher than the bot's role in the group hierarchy.",
          requiresDevContact: false,
          errorType: "permission",
        };
      }

      // Get the member's current VRChat group roles
      const groupMember = await getGroupMember(groupId, vrcUserId);
      if (!groupMember) {
        return {
          success: false,
          reason: "You are not a member of the VRChat group. Please join the group first.",
          requiresDevContact: false,
          errorType: "validation",
        };
      }

      // Get role mappings for this guild
      const roleMappings = await prisma.groupRoleMapping.findMany({
        where: {
          guildId,
          vrcGroupId: groupId,
        },
      });

      if (roleMappings.length === 0) {
        // No role mappings is not an error - just nothing to sync
        return { success: true };
      }

      // Get Discord member to check their roles
      const guild = await bot.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        return {
          success: false,
          reason: "Failed to fetch Discord guild. The bot may not be in the server or there may be a connectivity issue.",
          requiresDevContact: true,
          errorType: "validation",
        };
      }

      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) {
        return {
          success: false,
          reason: "Failed to fetch your Discord member information. Please ensure you are still in the server.",
          requiresDevContact: true,
          errorType: "validation",
        };
      }

      // Get the VRChat role IDs the member currently has (non-management only)
      // VRChat has two role arrays: roleIds (regular) and mRoleIds (management/permissions)
      // We need to check both to see if the user has the role
      const groupMemberTyped = groupMember as { roleIds?: string[]; mRoleIds?: string[] };
      const currentVrcRoleIds = new Set([
        ...(groupMemberTyped.roleIds || []),
        ...(groupMemberTyped.mRoleIds || []),
      ]);

      // Group mappings by VRChat role (since multiple Discord roles can map to one VRChat role)
      const vrcRoleToDiscordRoles = new Map<string, string[]>();
      for (const mapping of roleMappings) {
        if (!vrcRoleToDiscordRoles.has(mapping.vrcGroupRoleId)) {
          vrcRoleToDiscordRoles.set(mapping.vrcGroupRoleId, []);
        }
        const roleList = vrcRoleToDiscordRoles.get(mapping.vrcGroupRoleId);
        if (roleList) {
          roleList.push(mapping.discordRoleId);
        }
      }

      // Determine which VRChat roles should be added and removed based on Discord roles
      const vrcRolesToAdd: string[] = [];
      const vrcRolesToRemove: string[] = [];

      // For each VRChat role, check if user has ANY of the Discord roles that map to it
      for (const [vrcRoleId, discordRoleIds] of vrcRoleToDiscordRoles.entries()) {
        const hasVrcRole = currentVrcRoleIds.has(vrcRoleId);
        const hasAnyDiscordRole = discordRoleIds.some(discordRoleId => 
          member.roles.cache.has(discordRoleId)
        );

        if (hasAnyDiscordRole && !hasVrcRole) {
          vrcRolesToAdd.push(vrcRoleId);
        } else if (!hasAnyDiscordRole && hasVrcRole) {
          vrcRolesToRemove.push(vrcRoleId);
        }
      }

      // Apply VRChat role changes
      const roleErrors: string[] = [];
      
      if (vrcRolesToAdd.length > 0) {
        for (const roleId of vrcRolesToAdd) {
          try {
            await addRoleToGroupMember(groupId, vrcUserId, roleId);
          } catch (error: unknown) {
            loggers.vrchat.error(
              `Failed to add VRChat role ${roleId}`,
              error,
            );
            // Preserve VRChatError details if available
            if (error instanceof Error) {
              roleErrors.push(`Failed to add role: ${error.message}`);
            } else {
              roleErrors.push(`Failed to add role: ${String(error)}`);
            }
          }
        }
      }

      if (vrcRolesToRemove.length > 0) {
        for (const roleId of vrcRolesToRemove) {
          try {
            await removeRoleFromGroupMember(groupId, vrcUserId, roleId);
          } catch (error: unknown) {
            loggers.vrchat.error(
              `Failed to remove VRChat role ${roleId}`,
              error,
            );
            // Preserve VRChatError details if available
            if (error instanceof Error) {
              roleErrors.push(`Failed to remove role: ${error.message}`);
            } else {
              roleErrors.push(`Failed to remove role: ${String(error)}`);
            }
          }
        }
      }

      // If there were any role change errors, return failure result
      if (roleErrors.length > 0) {
        return {
          success: false,
          reason: `Failed to update some roles: ${roleErrors.join("; ")}`,
          requiresDevContact: true,
          errorType: "api",
        };
      }

      // Log the sync if there were changes
      if (vrcRolesToAdd.length > 0 || vrcRolesToRemove.length > 0) {
        await this.logRoleSync(
          guildId,
          member,
          vrcRolesToAdd,
          vrcRolesToRemove,
          "sync",
        );
      }

      return { success: true };
    } catch (error) {
      // Handle unexpected errors
      loggers.vrchat.error(
        `Error syncing roles for ${discordId}`,
        error,
      );
      
      const errorMessage = error instanceof Error 
        ? error.message 
        : "An unexpected error occurred while syncing roles.";
      
      return {
        success: false,
        reason: errorMessage,
        requiresDevContact: true,
        errorType: "unknown",
      };
    }
  }

  /**
   * Log a role sync action to the promotion logs channel
   */
  private async logRoleSync(
    guildId: string,
    member: GuildMember,
    vrcRolesAdded: string[],
    vrcRolesRemoved: string[],
    action: "sync" | "group-joined" | "discord-role-updated",
  ): Promise<void> {
    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
      });

      // Format VRChat role IDs
      const addedRoles =
        vrcRolesAdded.length > 0
          ? vrcRolesAdded.map((r) => `\`${r}\``).join(", ")
          : "None";
      const removedRoles =
        vrcRolesRemoved.length > 0
          ? vrcRolesRemoved.map((r) => `\`${r}\``).join(", ")
          : "None";

      let title = "🔄 VRChat Group Roles Synced";
      let color: number = Colors.Blue;
      let description = `VRChat group roles have been synced for ${member.user.tag} based on their Discord roles.`;

      if (action === "group-joined") {
        title = "✅ Member Joined VRChat Group";
        color = Colors.Green;
        description = `${member.user.tag} joined the VRChat group. Their VRChat roles have been assigned based on their Discord roles.`;
      } else if (action === "discord-role-updated") {
        title = "🔄 Discord Roles Changed";
        color = Colors.Gold;
        description = `${member.user.tag}'s Discord roles changed. Their VRChat group roles have been updated to match.`;
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .addFields(
          { name: "Member", value: `<@${member.id}>`, inline: true },
          {
            name: "Display Name",
            value: member.displayName || member.user.username,
            inline: true,
          },
          {
            name: "VRChat Roles Added",
            value: addedRoles,
            inline: false,
          },
          {
            name: "VRChat Roles Removed",
            value: removedRoles,
            inline: false,
          },
        )
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Role Sync" });

      await auditLogManager.fanOutWhitelistLog(
        guildId,
        { embeds: [embed] },
        [settings?.botPromotionLogsChannelId],
      );
    } catch (error) {
      loggers.vrchat.error("Error logging role sync", error);
    }
  }

  /**
   * Handle a user joining the VRChat group
   * Assigns VRChat group roles based on their Discord roles
   */
  async handleGroupJoined(
    guildId: string,
    discordId: string,
    vrcUserId: string,
  ): Promise<void> {
    const result = await this.syncUserRoles(guildId, discordId, vrcUserId);
    if (!result.success && result.errorType === "unknown") {
      // Only log unexpected errors for background operations
      loggers.vrchat.warn(
        `Failed to sync roles when user joined group: ${result.reason}`,
        { guildId, discordId, vrcUserId },
      );
    }
  }

  /**
   * Handle Discord role updates for a verified user
   * Updates their VRChat group roles to match
   */
  async handleDiscordRoleUpdate(
    guildId: string,
    discordId: string,
    vrcUserId: string,
  ): Promise<void> {
    const result = await this.syncUserRoles(guildId, discordId, vrcUserId);
    if (!result.success && result.errorType === "unknown") {
      // Only log unexpected errors for background operations
      loggers.vrchat.warn(
        `Failed to sync roles on Discord role update: ${result.reason}`,
        { guildId, discordId, vrcUserId },
      );
    }
  }

  /**
   * Handle a user leaving the VRChat group
   */
  async handleGroupLeft(
    guildId: string,
    discordId: string,
    _vrcUserId: string,
  ): Promise<void> {
    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
      });

      const guild = await bot.guilds.fetch(guildId);
      if (!guild) {
        return;
      }

      const member = await guild.members.fetch(discordId).catch(() => null);
      const displayName = member?.displayName || discordId;

      const embed = new EmbedBuilder()
        .setTitle("⬅️ Member Left VRChat Group")
        .setDescription(
          `${displayName} has left the VRChat group.`,
        )
        .addFields(
          { name: "Member", value: `<@${discordId}>`, inline: true },
          { name: "Display Name", value: displayName, inline: true },
        )
        .setColor(Colors.Orange)
        .setTimestamp()
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Role Sync" });

      await auditLogManager.fanOutWhitelistLog(
        guildId,
        { embeds: [embed] },
        [settings?.botPromotionLogsChannelId],
      );
    } catch (error) {
      loggers.vrchat.error("Error handling group left", error);
    }
  }
}

export const groupRoleSyncManager = new GroupRoleSyncManager();
