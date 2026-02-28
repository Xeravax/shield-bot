import { prisma } from "../../main.js";
import { searchUsers } from "../../utility/vrchat/user.js";
import { loggers } from "../../utility/logger.js";

/**
 * User operations for whitelist management
 */
export class WhitelistUserOperations {
  /**
   * Get a user from the database by Discord ID
   */
  async getUserByDiscordId(discordId: string, guildId: string) {
    return await prisma.user.findUnique({
      where: { discordId },
      include: {
        vrchatAccounts: true,
        whitelistEntries: {
          where: { guildId },
          include: {
            roleAssignments: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Get a user from the database by VRChat User ID
   */
  async getUserByVrcUserId(vrcUserId: string, guildId: string) {
    return await prisma.user.findFirst({
      where: {
        vrchatAccounts: {
          some: {
            vrcUserId: vrcUserId,
          },
        },
      },
      include: {
        vrchatAccounts: true,
        whitelistEntries: {
          where: { guildId },
          include: {
            roleAssignments: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Add a user to the whitelist by Discord ID
   */
  async addUserByDiscordId(discordId: string, guildId: string): Promise<unknown> {
    const user = await prisma.user.findUnique({ where: { discordId } });
    if (!user) {
      throw new Error(
        "User not found in the database. User must be verified first.",
      );
    }

    // Check if already whitelisted in this guild
    const existing = await prisma.whitelistEntry.findUnique({
      where: { 
        userId_guildId: {
          userId: user.id,
          guildId: guildId,
        },
      },
    });

    if (existing) {
      throw new Error("User is already whitelisted in this guild.");
    }

    return await prisma.whitelistEntry.create({
      data: { userId: user.id, guildId: guildId },
      include: {
        user: {
          include: {
            vrchatAccounts: true,
          },
        },
      },
    });
  }

  /**
   * Add a user to the whitelist by VRChat username
   */
  async addUserByVrcUsername(vrchatUsername: string, guildId: string): Promise<unknown> {
    try {
      const searchResults = await searchUsers({ search: vrchatUsername, n: 1 });

      if (searchResults.length === 0) {
        throw new Error(`VRChat user "${vrchatUsername}" not found.`);
      }

      const vrcUser = searchResults[0] as { id: string };

      // Find the corresponding user in our database
      const user = await prisma.user.findFirst({
        where: {
          vrchatAccounts: {
            some: {
              vrcUserId: vrcUser.id,
            },
          },
        },
      });

      if (!user) {
        throw new Error(
          `User with VRChat account "${vrchatUsername}" not found in database. User must be verified first.`,
        );
      }

      return await this.addUserByDiscordId(user.discordId, guildId);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to add user by VRChat username: ${errorMessage}`,
      );
    }
  }

  /**
   * Remove a user from the whitelist by Discord ID.
   * Idempotent: safe to call when the entry is already gone (e.g. duplicate leave/ban events).
   */
  async removeUserByDiscordId(discordId: string, guildId: string): Promise<boolean> {
    try {
      const user = await prisma.user.findUnique({ where: { discordId } });
      if (!user) {
        return false;
      }

      const result = await prisma.whitelistEntry.deleteMany({
        where: {
          userId: user.id,
          guildId: guildId,
        },
      });
      return result.count > 0;
    } catch (error) {
      loggers.bot.error(
        `Failed to remove whitelist entry for ${discordId} in guild ${guildId}`,
        error,
      );
      return false;
    }
  }

  /**
   * Remove a user from the whitelist by VRChat User ID
   */
  async removeUserByVrcUserId(vrcUserId: string, guildId: string): Promise<boolean> {
    const user = await this.getUserByVrcUserId(vrcUserId, guildId);
    if (!user) {return false;}

    return await this.removeUserByDiscordId(user.discordId, guildId);
  }

  /**
   * Add user by VRChat User ID (alias for API compatibility)
   */
  async addUserByVrcUserId(vrcUserId: string, guildId: string): Promise<unknown> {
    const user = await this.getUserByVrcUserId(vrcUserId, guildId);
    if (!user) {
      throw new Error(
        "User not found in database. User must be verified first.",
      );
    }
    return await this.addUserByDiscordId(user.discordId, guildId);
  }

  /**
   * Remove user from whitelist if they have no qualifying roles
   * This function ensures complete removal of whitelist access for a specific guild
   */
  async removeUserFromWhitelistIfNoRoles(discordId: string, guildId: string): Promise<void> {
    const user = await this.getUserByDiscordId(discordId, guildId);
    if (!user || !user.whitelistEntries || user.whitelistEntries.length === 0) {
      loggers.bot.debug(
        `User ${discordId} not found or has no whitelist entry for guild ${guildId} - nothing to remove`,
      );
      return;
    }

    const whitelistEntry = user.whitelistEntries[0];
    // Get current role assignments for logging
    const currentAssignments = whitelistEntry.roleAssignments || [];
    const roleIds = currentAssignments.map(
      (assignment: { role: { discordRoleId: string | null; id: number } }) => assignment.role.discordRoleId || String(assignment.role.id),
    );

    // Remove whitelist entry (this will cascade delete role assignments)
    await prisma.whitelistEntry.delete({
      where: { 
        userId_guildId: {
          userId: user.id,
          guildId: guildId,
        },
      },
    });

    loggers.bot.info(
      `Removed user ${discordId} from whitelist in guild ${guildId} - had roles: [${roleIds.join(", ")}]`,
    );
  }

  /**
   * Get user's whitelist roles for a specific guild
   */
  async getUserWhitelistRoles(discordId: string, guildId: string): Promise<string[]> {
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

