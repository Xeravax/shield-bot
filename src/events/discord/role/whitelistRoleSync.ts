import { Discord, On, ArgsOf } from "discordx";
import { Role } from "discord.js";
import { WhitelistManager } from "../../../managers/whitelist/whitelistManager.js";
import { prisma } from "../../../main.js";
import { sendWhitelistLog } from "../../../utility/vrchat/whitelistLogger.js";
import { loggers } from "../../../utility/logger.js";

const whitelistManager = new WhitelistManager();

@Discord()
export class WhitelistRoleSync {
  // Build a human commit message using permissions list
  private buildCommitMessage(
    username: string,
    action: "added" | "removed" | "granted",
    permissions: Set<string>,
  ): string {
    const list = permissions.size
      ? Array.from(permissions).sort().join(", ")
      : "none";
    return `${username} was ${action} with the roles ${list}`;
  }

  // Resolve expected whitelist roles and permissions based on Discord roles
  private async getExpectedFromDiscordRoles(
    discordRoleIds: string[],
    guildId: string,
  ): Promise<{ roles: string[]; permissions: Set<string> }> {
    const roles: string[] = [];
    const permissions = new Set<string>();
    const roleMappings = await whitelistManager.getDiscordRoleMappings(guildId);
    for (const mapping of roleMappings) {
      const mappingTyped = mapping as { discordRoleId?: string; permissions?: string };
      if (!mappingTyped.discordRoleId) {continue;}
      if (discordRoleIds.includes(mappingTyped.discordRoleId)) {
        // Note: name field was removed, using discordRoleId as identifier
        roles.push(mappingTyped.discordRoleId);
        const perms = mappingTyped.permissions;
        if (perms)
          {for (const p of perms
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean))
            {permissions.add(p);}}
      }
    }
    return { roles, permissions };
  }

  @On({ event: "guildMemberUpdate" })
  async onGuildMemberUpdate([
    oldMember,
    newMember,
  ]: ArgsOf<"guildMemberUpdate">): Promise<void> {
    try {
      loggers.bot.info(
        `Syncing roles for ${newMember.displayName} (${newMember.id})`,
      );

      // Fetch full member data if oldMember is partial
      let fullOldMember = oldMember;
      if (oldMember.partial) {
        try {
          fullOldMember = await oldMember.fetch();
        } catch {
          loggers.bot.warn(
            `Could not fetch full member data for ${oldMember.id}, using available data`,
          );
          fullOldMember = oldMember;
        }
      }

      // Only process if roles changed
      const oldRoleIds =
        fullOldMember.roles?.cache?.map((role: Role) => role.id) || [];
      const newRoleIds =
        newMember.roles?.cache?.map((role: Role) => role.id) || [];

      loggers.bot.debug(
        `Role comparison for ${newMember.displayName}: old=${oldRoleIds.length}, new=${newRoleIds.length}`,
      );

      if (
        JSON.stringify(oldRoleIds.sort()) === JSON.stringify(newRoleIds.sort())
      ) {
        loggers.bot.debug(
          `No role changes detected for ${newMember.displayName}`,
        );
        return; // No role changes
      }

      // Check if user has any VRChat accounts (verified or unverified)
      const userHasVRChatAccount = await this.hasVRChatAccount(newMember.id);
      if (!userHasVRChatAccount) {
        loggers.bot.debug(
          `User ${newMember.displayName} has no VRChat account, skipping whitelist sync`,
        );
        return;
      }

      // Get current and expected state
      const guildId = newMember.guild.id;
      const currentUser = await whitelistManager.getUserByDiscordId(
        newMember.id,
        guildId,
      );
      // Get current role assignments by Discord role ID for comparison
      const whitelistEntry = (currentUser as { whitelistEntries?: Array<{ roleAssignments: Array<{ role: { discordRoleId: string | null; id: number } }> }> })?.whitelistEntries?.[0];
      const currentWhitelistRoles =
        whitelistEntry?.roleAssignments?.map(
          (a: { role: { discordRoleId: string | null; id: number } }) => a.role.discordRoleId || String(a.role.id),
        ) || [];
      const {
        roles: expectedWhitelistRoles,
        permissions: expectedPermissions,
      } = await this.getExpectedFromDiscordRoles(newRoleIds, guildId);

      // Compare current whitelist roles with expected roles using sets
      const currentRolesSorted = [...currentWhitelistRoles].sort();
      const expectedRolesSorted = [...expectedWhitelistRoles].sort();

      if (
        JSON.stringify(currentRolesSorted) ===
        JSON.stringify(expectedRolesSorted)
      ) {
        loggers.bot.debug(
          `No whitelist role changes needed for ${newMember.displayName} - Current: [${currentRolesSorted.join(", ")}], Expected: [${expectedRolesSorted.join(", ")}]`,
        );
        return; // No whitelist changes needed
      }

      loggers.bot.info(
        `Whitelist role changes detected for ${newMember.displayName} - Current: [${currentRolesSorted.join(", ")}], Expected: [${expectedRolesSorted.join(", ")}]`,
      );

      // Sync user roles (this handles both granting and removing access based on current roles)
      await whitelistManager.syncUserRolesFromDiscord(
        newMember.id,
        newRoleIds,
        newMember.guild.id,
      );

      // Get updated whitelist roles after sync
      const updatedWhitelistRoles =
        await this.getUserWhitelistRoles(newMember.id, guildId);

      loggers.bot.info(
        `Successfully updated whitelist for ${newMember.displayName}`,
      );

      // Send whitelist log message
      try {
        const vrchatInfo = await whitelistManager.getUserByDiscordId(
          newMember.id,
          guildId,
        );
        const primaryAccount = vrchatInfo?.vrchatAccounts?.[0];
        await sendWhitelistLog(newMember.client, newMember.guild.id, {
          discordId: newMember.id,
          displayName: newMember.displayName || newMember.user?.username || newMember.id,
          vrchatUsername: primaryAccount?.vrchatUsername || undefined,
          vrcUserId: primaryAccount?.vrcUserId,
          roles: updatedWhitelistRoles,
          action: updatedWhitelistRoles.length === 0 ? "removed" : "modified",
          accountType: primaryAccount?.accountType,
        });
      } catch (logError) {
        loggers.bot.warn(
          `Failed to send modification log for ${newMember.displayName}`,
          logError,
        );
      }

      // Publish whitelist with contextual commit message after role changes (use permissions, not Discord roles)
      try {
        const action: "added" | "removed" | "granted" =
          expectedRolesSorted.length === 0
            ? "removed"
            : currentRolesSorted.length === 0
              ? "added"
              : "granted";
        const username =
          newMember.displayName || newMember.user?.username || newMember.id;
        // Use expected permissions for commit message (if removed, show none)
        const permsForMsg =
          action === "removed" ? new Set<string>() : expectedPermissions;
        
        // Queue for batched update instead of immediate publish, passing the guild ID
        const msg = this.buildCommitMessage(username, action, permsForMsg);
        whitelistManager.queueBatchedUpdate(newMember.id, msg, newMember.guild.id);
        loggers.bot.info(
          `Queued GitHub repository update after role change for ${newMember.displayName}`,
        );
      } catch (repoError) {
        loggers.bot.warn(
          `Failed to queue GitHub repository update after role change for ${newMember.displayName}`,
          repoError,
        );
      }
    } catch (error) {
      loggers.bot.error(
        `Error syncing roles for ${newMember.displayName}`,
        error,
      );
    }
  }

  @On({ event: "guildMemberAdd" })
  async onGuildMemberAdd([member]: ArgsOf<"guildMemberAdd">): Promise<void> {
    try {
      const roleIds = member.roles.cache.map((role: Role) => role.id);

      loggers.bot.info(
        `New member ${member.displayName} joined with ${roleIds.length} roles`,
      );

      // Check if user has any VRChat accounts (verified or unverified)
      const userHasVRChatAccount = await this.hasVRChatAccount(member.id);
      if (!userHasVRChatAccount) {
        loggers.bot.debug(
          `New member ${member.displayName} has no VRChat account, skipping whitelist sync`,
        );
        return;
      }

      // Sync their roles (this will grant access if they have qualifying roles)
      const guildId = member.guild.id;
      await whitelistManager.syncUserRolesFromDiscord(
        member.id,
        roleIds,
        guildId,
      );

      // Get updated whitelist roles after sync
      const updatedWhitelistRoles = await this.getUserWhitelistRoles(member.id, guildId);

      loggers.bot.info(
        `Successfully processed new member ${member.displayName}`,
      );

      // Send whitelist log message if they got whitelist access
      if (updatedWhitelistRoles.length > 0) {
        try {
          const vrchatInfo = await whitelistManager.getUserByDiscordId(
            member.id,
            guildId,
          );
          const primaryAccount = vrchatInfo?.vrchatAccounts?.[0];
          await sendWhitelistLog(member.client, member.guild.id, {
            discordId: member.id,
            displayName: member.displayName || member.user?.username || member.id,
            vrchatUsername: primaryAccount?.vrchatUsername || undefined,
            vrcUserId: primaryAccount?.vrcUserId,
            roles: updatedWhitelistRoles,
            action: "verified",
            accountType: primaryAccount?.accountType,
          });
        } catch (logError) {
          loggers.bot.warn(
            `Failed to send verification log for new member ${member.displayName}`,
            logError,
          );
        }
      }

      // Publish whitelist with contextual commit message after adding new member (use permissions)
      try {
        const username =
          member.displayName || member.user?.username || member.id;
        // Determine permissions user now should have
        const { permissions } = await this.getExpectedFromDiscordRoles(roleIds, guildId);
        
        // Queue for batched update instead of immediate publish, passing the guild ID
        const msg = this.buildCommitMessage(username, "added", permissions);
        whitelistManager.queueBatchedUpdate(member.id, msg, member.guild.id);
        loggers.bot.info(
          `Queued GitHub repository update after new member ${member.displayName} joined`,
        );
      } catch (repoError) {
        loggers.bot.warn(
          `Failed to queue GitHub repository update after new member ${member.displayName} joined`,
          repoError,
        );
      }
    } catch (error) {
      loggers.bot.error(
        `Error processing new member ${member.displayName}`,
        error,
      );
    }
  }
  @On({ event: "guildMemberRemove" })
  async onGuildMemberRemove([
    member,
  ]: ArgsOf<"guildMemberRemove">): Promise<void> {
    try {
      // Use displayName or fallback to user info
      const memberName =
        member.displayName ||
        member.user?.displayName ||
        member.user?.username ||
        member.id;
      loggers.bot.info(
        `Member ${memberName} left/kicked/banned - removing from whitelist`,
      );

      const guildId = member.guild.id;
      // Get their whitelist roles before removal for logging (failure must not block removal)
      let whitelistRoles: string[] = [];
      try {
        whitelistRoles = await this.getUserWhitelistRoles(member.id, guildId);
      } catch (rolesError) {
        loggers.bot.warn(
          `Failed to get whitelist roles for ${memberName} before removal`,
          rolesError,
        );
      }

      // Always remove from whitelist when they leave the server (includes kicks/bans)
      await whitelistManager.removeUserByDiscordId(member.id, guildId);

      // Send whitelist log message if they had whitelist access
      if (whitelistRoles.length > 0) {
        try {
          const vrchatInfo = await whitelistManager.getUserByDiscordId(
            member.id,
            guildId,
          );
          const primaryAccount = vrchatInfo?.vrchatAccounts?.[0];
          await sendWhitelistLog(member.client, member.guild.id, {
            discordId: member.id,
            displayName: memberName,
            vrchatUsername: primaryAccount?.vrchatUsername || undefined,
            vrcUserId: primaryAccount?.vrcUserId,
            roles: whitelistRoles,
            action: "removed",
            accountType: primaryAccount?.accountType,
          });
        } catch (logError) {
          loggers.bot.warn(
            `Failed to send removal log for ${memberName}`,
            logError,
          );
        }

        // Publish whitelist with contextual commit message after removing user
        // Only queue if they actually had whitelist access
        try {
          const username = memberName;
          
          // Queue for batched update instead of immediate publish, passing the guild ID
          const msg = `${username} was removed with the roles none`;
          whitelistManager.queueBatchedUpdate(member.id, msg, member.guild.id);
          loggers.bot.info(
            `Queued GitHub repository update after ${memberName} left server`,
          );
        } catch (repoError) {
          loggers.bot.warn(
            `Failed to queue GitHub repository update after ${memberName} left server`,
            repoError,
          );
        }
      }
    } catch (error) {
      const memberName =
        member.displayName ||
        member.user?.displayName ||
        member.user?.username ||
        member.id;
      loggers.bot.error(
        `Error removing member ${memberName} from whitelist`,
        error,
      );
    }
  }

  @On({ event: "guildBanAdd" })
  async onGuildBanAdd([ban]: ArgsOf<"guildBanAdd">): Promise<void> {
    try {
      const user = ban.user;
      const userName = user.displayName || user.username || user.id;
      const guildId = ban.guild.id;
      loggers.bot.info(
        `User ${userName} was banned - ensuring removal from whitelist`,
      );

      // Get their whitelist roles before removal for logging (failure must not block removal)
      let whitelistRoles: string[] = [];
      try {
        whitelistRoles = await this.getUserWhitelistRoles(user.id, guildId);
      } catch (rolesError) {
        loggers.bot.warn(
          `Failed to get whitelist roles for ${userName} before removal`,
          rolesError,
        );
      }

      // Ensure banned user is removed from whitelist
      await whitelistManager.removeUserByDiscordId(user.id, guildId);

      // Send whitelist log message if they had whitelist access
      if (whitelistRoles.length > 0) {
        try {
          const vrchatInfo = await whitelistManager.getUserByDiscordId(user.id, guildId);
          const primaryAccount = vrchatInfo?.vrchatAccounts?.[0];
          await sendWhitelistLog(ban.client, ban.guild.id, {
            discordId: user.id,
            displayName: userName,
            vrchatUsername: primaryAccount?.vrchatUsername || undefined,
            vrcUserId: primaryAccount?.vrcUserId,
            roles: whitelistRoles,
            action: "removed",
            accountType: primaryAccount?.accountType,
          });
        } catch (logError) {
          loggers.bot.warn(
            `Failed to send removal log for banned user ${userName}`,
            logError,
          );
        }
      }

      // Publish whitelist with contextual commit message after removing banned user
      try {
        const username = userName;
        
        // Queue for batched update instead of immediate publish, passing the guild ID
        const msg = `${username} was removed with the roles none`;
        whitelistManager.queueBatchedUpdate(user.id, msg, ban.guild.id);
        loggers.bot.info(
          `Queued GitHub repository update after ${userName} was banned`,
        );
      } catch (repoError) {
        loggers.bot.warn(
          `Failed to queue GitHub repository update after ${userName} was banned`,
          repoError,
        );
      }
    } catch (error) {
      const userName =
        ban.user?.displayName ||
        ban.user?.username ||
        ban.user?.id ||
        "Unknown";
      loggers.bot.error(
        `Error removing banned user ${userName} from whitelist`,
        error,
      );
    }
  }

  private async hasVRChatAccount(discordId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { discordId },
      include: {
        vrchatAccounts: {
          where: {
            accountType: {
              in: ["MAIN", "ALT", "UNVERIFIED"],
            },
          },
        },
      },
    });

    return user ? user.vrchatAccounts.length > 0 : false;
  }

  private async getUserWhitelistRoles(discordId: string, guildId: string): Promise<string[]> {
    try {
      const user = await prisma.user.findUnique({
        where: { discordId },
        include: {
          whitelistEntries: {
            where: { guildId },
            include: {
              roleAssignments: {
                where: {
                  role: {
                    guildId: guildId,
                  },
                },
                include: {
                  role: true,
                },
              },
            },
          },
        },
      });

      // Extract VRChat roles from permissions field (comma-separated)
      const roles = new Set<string>();
      for (const entry of user?.whitelistEntries || []) {
        for (const assignment of entry.roleAssignments || []) {
          if (assignment.role.permissions) {
            for (const role of String(assignment.role.permissions)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)) {
              roles.add(role);
            }
          }
        }
      }
      return Array.from(roles).sort();
    } catch (error) {
      loggers.bot.error(
        `Failed to get whitelist roles for ${discordId} in guild ${guildId}`,
        error,
      );
      return [];
    }
  }
}
