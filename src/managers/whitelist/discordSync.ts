import { prisma } from "../../main.js";
import { bot } from "../../main.js";
import { loggers } from "../../utility/logger.js";

/**
 * Discord role synchronization operations
 */
export class DiscordSync {
  /**
   * Sync user roles from Discord
   */
  async syncUserRolesFromDiscord(
    discordId: string,
    discordRoleIds: string[],
    guildId: string,
    removeUserFromWhitelistIfNoRoles?: (_discordId: string, _guildId: string) => Promise<void>,
  ): Promise<void> {
    // Ensure user exists in database first
    const user = await prisma.user.findUnique({ 
      where: { discordId },
      include: {
        vrchatAccounts: true,
      },
    });
    
    if (!user) {
      loggers.bot.debug(
        `User ${discordId} not found in database, skipping sync`,
      );
      return;
    }

    // Check if user has any verified VRChat accounts (MAIN or ALT)
    const hasVerifiedAccount = user.vrchatAccounts?.some(
      (acc: { accountType: string }) => acc.accountType === "MAIN" || acc.accountType === "ALT"
    ) ?? false;

    if (!hasVerifiedAccount) {
      // User is not verified, remove from whitelist if present
      if (removeUserFromWhitelistIfNoRoles) {
        await removeUserFromWhitelistIfNoRoles(discordId, guildId);
      }
      loggers.bot.info(
        `User ${discordId} has no verified VRChat accounts - removed from whitelist in guild ${guildId}`,
      );
      return;
    }

    // Get mapped roles for the user's Discord roles, filtered by guild
    const validMappedRoles = await prisma.whitelistRole.findMany({
      where: {
        discordRoleId: {
          in: discordRoleIds,
        },
        guildId: guildId,
      },
    });

    if (validMappedRoles.length === 0) {
      // User has no qualifying roles, remove from whitelist if present
      if (removeUserFromWhitelistIfNoRoles) {
        await removeUserFromWhitelistIfNoRoles(discordId, guildId);
      }
      loggers.bot.info(
        `User ${discordId} has no qualifying Discord roles in guild ${guildId} - removed from whitelist`,
      );
      return;
    }

    // Ensure user has whitelist entry for this guild
    await prisma.whitelistEntry.upsert({
      where: { 
        userId_guildId: {
          userId: user.id,
          guildId: guildId,
        },
      },
      update: {},
      create: { userId: user.id, guildId: guildId },
    });

    const whitelistEntry = await prisma.whitelistEntry.findUnique({
      where: { 
        userId_guildId: {
          userId: user.id,
          guildId: guildId,
        },
      },
      include: {
        roleAssignments: {
          where: {
            role: {
              guildId: guildId,
            },
          },
        },
      },
    });

    // Get current role assignments
    if (!whitelistEntry) {
      loggers.bot.warn(`Whitelist entry not found for user ${discordId} in guild ${guildId}`);
      return;
    }
    const existingAssignments = whitelistEntry.roleAssignments || [];
    const existingRoleIds = new Set(existingAssignments.map((a: { roleId: number }) => a.roleId));
    const newRoleIds = new Set(validMappedRoles.map((r: { id: number }) => r.id));

    // Remove assignments that are no longer valid (role no longer mapped to Discord roles)
    const assignmentsToRemove = existingAssignments.filter(
      (a: { roleId: number }) => !newRoleIds.has(a.roleId),
    );
    for (const assignment of assignmentsToRemove) {
      await prisma.whitelistRoleAssignment.delete({
        where: { id: assignment.id },
      });
    }

    // Add new role assignments for mapped roles that don't exist yet
    const rolesToAdd = validMappedRoles.filter((r: { id: number }) => !existingRoleIds.has(r.id));
    for (const role of rolesToAdd) {
      await prisma.whitelistRoleAssignment.create({
        data: {
          whitelistId: whitelistEntry.id,
          roleId: role.id,
          assignedBy: "Discord Role Sync",
        },
      });
    }

    // Get permission list for logging
    const allPermissions = new Set<string>();
    for (const role of validMappedRoles) {
      if (role.permissions) {
        role.permissions
          .split(",")
          .map((p: string) => p.trim())
          .filter(Boolean)
          .forEach((p: string) => allPermissions.add(p));
      }
    }

    loggers.bot.info(
      `User ${discordId} synced in guild ${guildId} with ${validMappedRoles.length} role(s) and permissions: [${Array.from(allPermissions).join(", ")}]`,
    );
  }

  /**
   * Sync whitelist roles and publish after user verification
   */
  async syncAndPublishAfterVerification(
    discordId: string,
    botOverride: unknown,
    getDiscordRoleMappings: (_guildId?: string) => Promise<unknown[]>,
    syncUserRolesFromDiscord: (_discordId: string, _roleIds: string[], _guildId: string) => Promise<void>,
    getUserByDiscordId: (_discordId: string, _guildId: string) => Promise<unknown>,
    getUserWhitelistRoles: (_discordId: string, _guildId: string) => Promise<string[]>,
    queueBatchedUpdate: (_discordId: string, _commitMessage?: string, _guildId?: string) => void,
    guildId?: string,
  ): Promise<void> {
    const activeBot = (botOverride ?? bot) as { guilds?: { cache?: { values: () => IterableIterator<unknown> }; fetch: (_guildId: string) => Promise<unknown> } };
    const guildManager = activeBot?.guilds;
    if (!guildManager) {
      loggers.bot.warn(
        `Discord client unavailable; skipping whitelist sync for ${discordId}`,
      );
      return;
    }
    try {
      // guildId is required - only sync for the specific guild provided
      if (!guildId) {
        loggers.bot.warn(
          `No guildId provided for whitelist sync of user ${discordId}; skipping sync`,
        );
        return;
      }

      // Fetch the member from the specified guild only
      const targetGuild = await guildManager.fetch(guildId).catch(() => null) as { members: { fetch: (_id: string) => Promise<unknown> } } | null;
      if (!targetGuild) {
        loggers.bot.warn(
          `Failed to fetch guild ${guildId} for whitelist sync of user ${discordId}`,
        );
        return;
      }

      let member: unknown = null;
      try {
        member = await targetGuild.members.fetch(discordId);
      } catch (memberError) {
        loggers.bot.debug(
          `Discord user ${discordId} not found in guild ${guildId}; skipping whitelist sync`,
          memberError,
        );
        return;
      }

      const roleIds: string[] = (member as { roles: { cache: { map: (_fn: (_role: unknown) => string) => string[] } } }).roles.cache.map((_role: unknown) => (_role as { id: string }).id);
      if (!roleIds.length) {
        loggers.bot.debug(
          `Discord user ${discordId} has no roles in guild ${guildId}; skipping whitelist sync`,
        );
        return;
      }

      // Determine if user has eligible mapped roles and collect permissions for commit message
      // Use the provided guildId for syncing
      const mappings = await getDiscordRoleMappings(guildId);
      const eligible = mappings.filter(
        (m: unknown) => (m as { discordRoleId?: string }).discordRoleId && roleIds.includes((m as { discordRoleId: string }).discordRoleId),
      );
      if (eligible.length === 0) {
        loggers.bot.debug(
          `Discord user ${discordId} has no eligible mapped roles in guild ${guildId}; skipping whitelist sync`,
        );
        return;
      }

      // Sync whitelist role assignments using the provided guildId
      await syncUserRolesFromDiscord(discordId, roleIds, guildId);

      // Get VRChat account info and whitelist roles for logging (currently unused but kept for future use)
      void await getUserByDiscordId(discordId, guildId);
      void await getUserWhitelistRoles(discordId, guildId);

      // Build permissions list from mapping permissions
      const permSet = new Set<string>();
      for (const m of eligible) {
        const mapping = m as { permissions?: string };
        if (mapping.permissions) {
          for (const p of String(mapping.permissions)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean))
            {permSet.add(p);}
        }
      }
      const permissions = Array.from(permSet).sort();
      const who = (member as { displayName?: string; user?: { username?: string } }).displayName || (member as { user?: { username?: string } }).user?.username || discordId;
      const msg = `${who} was added with the roles ${permissions.length ? permissions.join(", ") : "none"}`;

      // Note: Whitelist logging is handled by the specific callers (verification handlers, account managers)
      // to ensure the correct context and action type (verified/removed) is logged

      // Queue batched update instead of immediate publish, passing the guild ID
      queueBatchedUpdate(discordId, msg, guildId);
      loggers.bot.info(
        `Queued repository update after verification for ${who}`,
      );
    } catch (e) {
      loggers.bot.warn(
        `Failed to sync/publish whitelist for verified user ${discordId}`,
        e,
      );
    }
  }
}

