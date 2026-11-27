import { purgeCloudflareCache } from "../../utility/cloudflare/purgeCache.js";
import { prisma } from "../../main.js";
import { bot } from "../../main.js";
import { WhitelistUserOperations } from "./userOperations.js";
import { WhitelistRoleOperations } from "./roleOperations.js";
import { WhitelistGeneration } from "./whitelistGeneration.js";
import { GitHubPublisher } from "./githubPublisher.js";
import { DiscordSync } from "./discordSync.js";
import { loggers } from "../../utility/logger.js";

/**
 * Main whitelist manager that orchestrates all whitelist operations
 */
export class WhitelistManager {
  // Batching mechanism for GitHub updates
  private pendingUpdates: Set<string> = new Set();
  private affectedGuildIds: Set<string> = new Set();
  private updateTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_DELAY_MS = 5000; // Wait 5 seconds after last change before updating
  // Tracked per guild: each guild publishes its own whitelist, so one guild's content or
  // publish time must not decide whether another guild's update is skipped.
  private lastPublishedContent: Map<string, string> = new Map();
  private lastUpdateTimestamps: Map<string, number> = new Map();  public getLastUpdateTimestamp(guildId: string): number | null {
    return this.lastUpdateTimestamps.get(guildId) ?? null;
  }

  // Module instances
  private userOps: WhitelistUserOperations;
  private roleOps: WhitelistRoleOperations;
  private generation: WhitelistGeneration;
  private githubPublisher: GitHubPublisher;
  private discordSync: DiscordSync;

  constructor() {
    this.userOps = new WhitelistUserOperations();
    this.roleOps = new WhitelistRoleOperations();
    this.generation = new WhitelistGeneration();
    this.githubPublisher = new GitHubPublisher();
    this.discordSync = new DiscordSync();
  }

  // ========== User Operations ==========
  async getUserByDiscordId(discordId: string, guildId: string) {
    return this.userOps.getUserByDiscordId(discordId, guildId);
  }

  async getUserByVrcUserId(vrcUserId: string, guildId: string) {
    return this.userOps.getUserByVrcUserId(vrcUserId, guildId);
  }

  async addUserByDiscordId(discordId: string, guildId: string): Promise<unknown> {
    return this.userOps.addUserByDiscordId(discordId, guildId);
  }

  async addUserByVrcUsername(vrchatUsername: string, guildId: string): Promise<unknown> {
    return this.userOps.addUserByVrcUsername(vrchatUsername, guildId);
  }

  async removeUserByDiscordId(discordId: string, guildId: string): Promise<boolean> {
    return this.userOps.removeUserByDiscordId(discordId, guildId);
  }

  async removeUserByVrcUserId(vrcUserId: string, guildId: string): Promise<boolean> {
    return this.userOps.removeUserByVrcUserId(vrcUserId, guildId);
  }

  async addUserByVrcUserId(vrcUserId: string, guildId: string): Promise<unknown> {
    return this.userOps.addUserByVrcUserId(vrcUserId, guildId);
  }

  async removeUserFromWhitelistIfNoRoles(discordId: string, guildId: string): Promise<void> {
    return this.userOps.removeUserFromWhitelistIfNoRoles(discordId, guildId);
  }

  async getUserWhitelistRoles(discordId: string, guildId: string): Promise<string[]> {
    return this.userOps.getUserWhitelistRoles(discordId, guildId);
  }

  // ========== Role Operations ==========
  async createRole(
    guildId: string,
    permissions?: string,
    discordRoleId?: string,
  ): Promise<unknown> {
    return this.roleOps.createRole(guildId, permissions, discordRoleId);
  }

  async deleteRole(guildId: string, discordRoleId: string): Promise<boolean> {
    return this.roleOps.deleteRole(guildId, discordRoleId);
  }

  async assignRoleByDiscordId(
    discordId: string,
    roleId: number,
    assignedBy?: string,
    expiresAt?: Date,
  ): Promise<unknown> {
    return this.roleOps.assignRoleByDiscordId(discordId, roleId, assignedBy, expiresAt);
  }

  async removeRoleByDiscordId(
    discordId: string,
    roleId: number,
  ): Promise<boolean> {
    return this.roleOps.removeRoleByDiscordId(discordId, roleId);
  }

  async getAllRoles(): Promise<unknown[]> {
    return this.roleOps.getAllRoles();
  }

  async setupDiscordRoleMapping(
    discordRoleId: string,
    guildId: string,
    permissions: string[],
  ): Promise<unknown> {
    return this.roleOps.setupDiscordRoleMapping(discordRoleId, guildId, permissions);
  }

  async getDiscordRoleMappings(guildId?: string): Promise<unknown[]> {
    return this.roleOps.getDiscordRoleMappings(guildId);
  }

  async shouldUserBeWhitelisted(discordRoleIds: string[], guildId?: string): Promise<boolean> {
    return this.roleOps.shouldUserBeWhitelisted(discordRoleIds, guildId);
  }

  async cleanupExpiredRoles(): Promise<number> {
    return this.roleOps.cleanupExpiredRoles();
  }

  async assignRoleByVrcUserId(
    vrcUserId: string,
    roleId: number,
    assignedBy?: string,
    expiresAt?: Date,
  ): Promise<unknown> {
    // Get role to extract guildId
    const role = await prisma.whitelistRole.findUnique({
      where: { id: roleId },
    });
    if (!role) {
      throw new Error(`Role with ID "${roleId}" not found`);
    }
    // Capture guildId once to avoid redundant lookups in the closure
    const roleGuildId = role.guildId;
    if (!roleGuildId) {
      throw new Error(`Role with ID "${roleId}" has no guildId`);
    }
    return this.roleOps.assignRoleByVrcUserId(
      vrcUserId,
      roleId,
      // Use the captured roleGuildId instead of the passed guildId parameter to avoid redundant DB lookups
      (_vrcUserId: string, _guildId: string) => this.userOps.getUserByVrcUserId(_vrcUserId, roleGuildId),
      assignedBy,
      expiresAt,
    );
  }

  // ========== Whitelist Generation ==========
  async getWhitelistUsers(guildId: string): Promise<unknown[]> {
    return this.generation.getWhitelistUsers(guildId);
  }

  async generateWhitelistContent(guildId: string): Promise<string> {
    return this.generation.generateWhitelistContent(guildId);
  }

  async generateEncodedWhitelistV2(guildId: string): Promise<{ encoded: string; contentHash: string }> {
    return this.generation.generateEncodedWhitelistV2(guildId);
  }

  async generateWhitelistContentV2(guildId: string): Promise<{ content: string; contentHash: string }> {
    return this.generation.generateWhitelistContentV2(guildId);
  }

  async generateEncodedWhitelist(guildId: string): Promise<string> {
    return this.generation.generateEncodedWhitelist(guildId);
  }

  // ========== GitHub Publishing ==========
  /**
   * Publish the whitelist to the configured GitHub repository.
   * Writes both encoded and decoded files in a single commit.
   * Now checks if content changed before publishing to avoid unnecessary commits.
   */
  async publishWhitelist(guildId: string, commitMessage?: string, force: boolean = false, affectedGuildIds?: string[]): Promise<{
    updated: boolean;
    commitSha?: string;
    paths?: string[];
    branch?: string;
    reason?: string;
  }> {
    // Use the provided guildId or the first affected guild
    const settingsGuildId = guildId || (affectedGuildIds && affectedGuildIds.length > 0 ? affectedGuildIds[0] : undefined);
    
    if (!settingsGuildId) {
      throw new Error("guildId is required for publishing whitelist");
    }

    // Generate content to check if it changed
    const currentContent = await this.generation.generateWhitelistContent(settingsGuildId);

    // Skip update if content hasn't changed (unless forced)
    const previousContent = this.lastPublishedContent.get(settingsGuildId);
    if (!force && previousContent !== undefined && currentContent === previousContent) {
      loggers.bot.debug('Content unchanged, skipping GitHub update');
      return { updated: false, reason: 'Content unchanged' };
    }

    const [encodedData, decodedData, v2Raw, v2Encoded] = await Promise.all([
      this.generation.generateEncodedWhitelist(settingsGuildId),
      this.generation.generateWhitelistContent(settingsGuildId),
      this.generation.generateWhitelistContentV2(settingsGuildId),
      this.generation.generateEncodedWhitelistV2(settingsGuildId),
    ]);
    // v1 and v2 files go out in one commit so the GitHub fallback never serves mixed versions.
    const result = await this.githubPublisher.updateRepositoryWithWhitelist(
      encodedData,
      decodedData,
      commitMessage,
      settingsGuildId,
      { encodedData: v2Encoded.encoded, decodedData: v2Raw.content },
    );

    // Store the published content for future comparisons
    if (result.updated) {
      this.lastPublishedContent.set(settingsGuildId, currentContent);
      this.lastUpdateTimestamps.set(settingsGuildId, Date.now());      // Purge Cloudflare cache for affected guilds' whitelist URLs
      const zoneId = process.env.CLOUDFLARE_ZONE_ID ?? "";
      const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
      
      if (zoneId && apiToken) {
        try {
          // Determine which guilds to purge cache for
          let targetGuildIds: string[] = [];
          
          if (guildId) {
            // Validate that the specific guild has whitelist role mappings
            const hasWhitelistRoles = await prisma.whitelistRole.findFirst({
              where: { guildId },
            });
            if (hasWhitelistRoles) {
              targetGuildIds = [guildId];
            } else {
              loggers.bot.debug(`Guild ${guildId} has no whitelist roles configured, skipping cache purge`);
              return result;
            }
          } else if (affectedGuildIds && affectedGuildIds.length > 0) {
            // Validate that all affected guild IDs have whitelist role mappings
            const guildsWithWhitelistRoles = await prisma.whitelistRole.findMany({
              where: {
                guildId: {
                  in: affectedGuildIds,
                },
              },
              select: {
                guildId: true,
              },
              distinct: ['guildId'],
            });
            
            const validGuildIds = new Set(
              guildsWithWhitelistRoles
                .map((r: { guildId: string | null }) => r.guildId)
                .filter((id: string | null): id is string => id !== null)
            );
            
            targetGuildIds = affectedGuildIds.filter(gid => validGuildIds.has(gid));
            
            if (targetGuildIds.length === 0) {
              loggers.bot.debug('No valid guilds with whitelist roles found in affected guilds, skipping cache purge');
              return result;
            }
          } else {
            // Fallback: find all guilds that have whitelist role mappings
            const allRoles = await prisma.whitelistRole.findMany({
              select: { guildId: true },
              distinct: ['guildId'],
            });
            targetGuildIds = allRoles
              .map((role: { guildId: string | null }) => role.guildId)
              .filter((id: string | null): id is string => id !== null);
            
            // Only use default if no guilds found at all (edge case)
            if (targetGuildIds.length === 0) {
              loggers.bot.warn('No guilds with whitelist roles found, skipping cache purge');
              return result;
            }
          }
          
          for (const gid of targetGuildIds) {
            const urls = [
              `https://api.vrcshield.com/api/vrchat/${gid}/whitelist/encoded`,
              `https://api.vrcshield.com/api/vrchat/${gid}/whitelist/v2/encoded`,
              `https://api.vrcshield.com/api/vrchat/${gid}/whitelist/v2/raw`,
              `https://api.vrcshield.com/api/vrchat/${gid}/whitelist/raw`,
              `https://api.vrcshield.com/api/vrchat/whitelist/encoded`
            ];
            await purgeCloudflareCache(zoneId, apiToken, urls);
            loggers.bot.info(`Purged Cloudflare cache for guild ${gid}`);
          }
        } catch (err) {
          loggers.bot.warn(`Cloudflare purge failed`, err);
        }
      } else {
        loggers.bot.debug(`Cloudflare cache purge skipped - missing zone ID or API token`);
      }
    }
    return result;
  }

  private resettingGuilds: Set<string> = new Set();

  /**
   * Clear a guild's published whitelist (GitHub files + API endpoints) and then regenerate it
   * from the database. The database is not modified: the generator is forced to output an empty
   * list while cleared, so both the API and the GitHub publish serve nothing until it is lifted.
   * The cleared state is always lifted (and the real list republished), even if a step fails.
   */
  async resetAndRegenerate(
    guildId: string,
    holdMs: number = 0,
    triggeredBy?: string,
  ): Promise<{
    clear: { updated: boolean; commitSha?: string; error?: string };
    regenerate: { updated: boolean; commitSha?: string; error?: string };
    userCount: number;
  }> {
    if (this.resettingGuilds.has(guildId)) {
      throw new Error("A whitelist reset is already running for this guild");
    }
    this.resettingGuilds.add(guildId);
    const by = triggeredBy ? ` by ${triggeredBy}` : "";

    const clear: { updated: boolean; commitSha?: string; error?: string } = { updated: false };
    const regenerate: { updated: boolean; commitSha?: string; error?: string } = { updated: false };

    try {
      this.generation.setCleared(guildId, true);
      loggers.bot.warn(`Whitelist for guild ${guildId} cleared${by} (database untouched)`);
      try {
        const r = await this.publishWhitelist(guildId, `reset: clear whitelist${by}`, true);
        clear.updated = r.updated;
        clear.commitSha = r.commitSha;
      } catch (err) {
        clear.error = err instanceof Error ? err.message : String(err);
        loggers.bot.warn(`Whitelist reset: clearing GitHub failed for guild ${guildId}`, err);
      }

      if (holdMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, holdMs));
      }
    } finally {
      this.generation.setCleared(guildId, false);
      try {
        const r = await this.publishWhitelist(guildId, `reset: regenerate whitelist${by}`, true);
        regenerate.updated = r.updated;
        regenerate.commitSha = r.commitSha;
      } catch (err) {
        regenerate.error = err instanceof Error ? err.message : String(err);
        loggers.bot.error(`Whitelist reset: regenerating GitHub failed for guild ${guildId}`, err);
      }
      this.resettingGuilds.delete(guildId);
      loggers.bot.info(`Whitelist for guild ${guildId} regenerated${by}`);
    }

    const userCount = Object.keys(await this.generation.generateWhitelistUsersJson(guildId)).length;
    return { clear, regenerate, userCount };
  }

  /**
   * Store a VRChat account's current display name and, if it changed, republish every guild
   * whitelist the account is on. Worlds match players by display name, so a stale name locks
   * the member out and leaves their old name free for someone else to claim.
   * Returns true when the name changed.
   */
  async applyVrchatDisplayName(vrcUserId: string, displayName: string, source: string): Promise<boolean> {
    const accounts = await prisma.vRChatAccount.findMany({
      where: { vrcUserId },
      select: {
        id: true,
        vrchatUsername: true,
        accountType: true,
        user: { select: { discordId: true } },
      },
    });

    let changed = false;
    for (const account of accounts) {
      const previous = account.vrchatUsername;
      await prisma.vRChatAccount.update({
        where: { id: account.id },
        data: { vrchatUsername: displayName, usernameUpdatedAt: new Date() },
      });
      if (previous === displayName) {continue;}
      changed = true;

      // Only verified accounts are published; pending verifications are not on any whitelist.
      if (account.accountType === "MAIN" || account.accountType === "ALT") {
        loggers.vrchat.info(
          `VRChat display name changed (${source}) for ${vrcUserId}: ${previous ?? "unknown"} → ${displayName}`,
        );
        // Keyed by Discord ID with no guild: the batch looks up every guild this user is whitelisted in.
        this.queueBatchedUpdate(
          account.user.discordId,
          `Username updated: ${previous ?? "unknown"} → ${displayName}`,
        );
      }
    }
    return changed;
  }

  /**
   * Delete role assignments whose expiresAt has passed and republish the affected guilds.
   * Generation already ignores expired assignments, but without a publish the hosted file and
   * the Cloudflare-cached API response keep serving them.
   * Returns the number of assignments removed.
   */
  async expireRolesAndPublish(): Promise<number> {
    const expired = await prisma.whitelistRoleAssignment.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: {
        id: true,
        whitelist: { select: { guildId: true, user: { select: { discordId: true } } } },
      },
    });
    if (expired.length === 0) {return 0;}

    await prisma.whitelistRoleAssignment.deleteMany({
      where: { id: { in: expired.map((assignment) => assignment.id) } },
    });

    const queued = new Set<string>();
    for (const assignment of expired) {
      const { guildId, user } = assignment.whitelist;
      const key = `${guildId}:${user.discordId}`;
      if (queued.has(key)) {continue;}
      queued.add(key);
      this.queueBatchedUpdate(user.discordId, "Expired whitelist roles removed", guildId);
    }

    loggers.bot.info(
      `Removed ${expired.length} expired whitelist role assignment(s) for ${queued.size} user/guild pair(s)`,
    );
    return expired.length;
  }

  /**
   * Queue a user for batched whitelist update
   * This collects changes and publishes once after a delay
   * @param discordId - The Discord user ID
   * @param commitMessage - Optional commit message
   * @param guildId - Optional guild ID that was affected by this change
   */
  queueBatchedUpdate(discordId: string, commitMessage?: string, guildId?: string): void {
    this.pendingUpdates.add(discordId);
    
    // Track affected guild if provided
    if (guildId) {
      this.affectedGuildIds.add(guildId);
    }

    // Clear existing timer and start a new one
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }

    this.updateTimer = setTimeout(async () => {
      await this.processBatchedUpdates(commitMessage);
    }, this.BATCH_DELAY_MS);
  }

  /**
   * Check if any of the updated users have rooftop permissions
   */
  private async checkForRooftopPermissionChanges(
    discordIds: string[],
    guildId: string,
  ): Promise<boolean> {
    try {
      const rooftopPermissions = [
        "rooftop_announce",
        "rooftop_dj",
        "rooftop_bouncer",
        "rooftop_staffplus",
        "rooftop_staff",
        "rooftop_vip",
        "rooftop_vipplus",
      ];

      const entries = await prisma.whitelistEntry.findMany({
        where: {
          user: {
            discordId: {
              in: discordIds,
            },
          },
          guildId: guildId,
        },
        select: {
          roleAssignments: {
            where: {
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
            select: {
              role: {
                select: {
                  permissions: true,
                },
              },
            },
          },
        },
      });

      for (const entry of entries) {
        for (const assignment of entry.roleAssignments) {
          if (assignment.role.permissions) {
            const permissionList = assignment.role.permissions
              .split(",")
              .map((p: string) => p.trim());
            if (
              rooftopPermissions.some((rooftopPerm) =>
                permissionList.includes(rooftopPerm),
              )
            ) {
              return true;
            }
          }
        }
      }
      return false;
    } catch (error) {
      loggers.bot.warn("Error checking for rooftop permission changes", error);
      return false;
    }
  }

  /**
   * Process all pending batched updates
   */
  private async processBatchedUpdates(commitMessage?: string): Promise<void> {
    if (this.pendingUpdates.size === 0) {
      return;
    }

    const count = this.pendingUpdates.size;
    const users = Array.from(this.pendingUpdates);
    const guildIds = Array.from(this.affectedGuildIds);
    
    // Clear pending updates and affected guilds
    this.pendingUpdates.clear();
    this.affectedGuildIds.clear();
    this.updateTimer = null;

    loggers.bot.info(`Processing batched update for ${count} users`);

    try {
      // Determine affected guilds from users' role assignments if not already tracked
      let finalAffectedGuildIds = guildIds;
      if (finalAffectedGuildIds.length === 0) {
        // Find all guilds that have whitelist entries for these users
        const entries = await prisma.whitelistEntry.findMany({
          where: {
            user: {
              discordId: {
                in: users,
              },
            },
          },
          select: {
            guildId: true,
          },
          distinct: ['guildId'],
        });

        finalAffectedGuildIds = entries
          .map((entry: { guildId: string | null }) => entry.guildId)
          .filter((id: string | null): id is string => id !== null);
        
        // Only include guilds that actually have whitelist role mappings configured
        // This prevents applying changes to guilds without whitelists
        if (finalAffectedGuildIds.length > 0) {
          const guildsWithWhitelistRoles = await prisma.whitelistRole.findMany({
            where: {
              guildId: {
                in: finalAffectedGuildIds,
              },
            },
            select: {
              guildId: true,
            },
            distinct: ['guildId'],
          });
          
          const validGuildIds = new Set(
            guildsWithWhitelistRoles
              .map((r: { guildId: string | null }) => r.guildId)
              .filter((id: string | null): id is string => id !== null)
          );
          
          // Filter to only guilds that have whitelist roles configured
          finalAffectedGuildIds = finalAffectedGuildIds.filter(gid => validGuildIds.has(gid));
        }
      } else {
        // Validate that tracked guild IDs actually have whitelist role mappings
        const guildsWithWhitelistRoles = await prisma.whitelistRole.findMany({
          where: {
            guildId: {
              in: finalAffectedGuildIds,
            },
          },
          select: {
            guildId: true,
          },
          distinct: ['guildId'],
        });
        
        const validGuildIds = new Set(
          guildsWithWhitelistRoles
            .map((r: { guildId: string | null }) => r.guildId)
            .filter((id: string | null): id is string => id !== null)
        );
        
        // Filter to only guilds that have whitelist roles configured
        finalAffectedGuildIds = finalAffectedGuildIds.filter(gid => validGuildIds.has(gid));
      }

      // Generate a meaningful commit message if not provided
      let message = commitMessage;
      if (!message || message.trim().length === 0) {
        if (count === 1 && finalAffectedGuildIds.length > 0) {
          // Try to get the user's name for single updates
          try {
            const user = await this.userOps.getUserByDiscordId(users[0], finalAffectedGuildIds[0]);
            const name = (user as { vrchatAccounts?: Array<{ vrchatUsername?: string }> })?.vrchatAccounts?.[0]?.vrchatUsername || users[0];
            message = `Updated whitelist for ${name}`;
          } catch {
            message = `Updated whitelist for 1 user`;
          }
        } else {
          message = `Updated whitelist for ${count} users`;
        }
      }

      // Publish for each affected guild
      for (const gid of finalAffectedGuildIds) {
        await this.publishWhitelist(gid, message, false, [gid]);
      }

      // Check if any rooftop permissions were updated and publish rooftop files if needed
      // Check for each affected guild
      let hasRooftopChanges = false;
      for (const gid of finalAffectedGuildIds) {
        const hasChanges = await this.checkForRooftopPermissionChanges(users, gid);
        if (hasChanges) {
          hasRooftopChanges = true;
          break;
        }
      }
      if (hasRooftopChanges) {
        loggers.bot.info("Rooftop permissions changed, updating rooftop files");
        try {
          // Use first affected guild for rooftop files
          const rooftopGuildId = finalAffectedGuildIds.length > 0 ? finalAffectedGuildIds[0] : undefined;
          if (rooftopGuildId) {
            await this.githubPublisher.updateRepositoryWithRooftopFiles(
              rooftopGuildId,
              `chore(rooftop): update rooftop files after whitelist change`,
            );
          }
        } catch (error) {
          loggers.bot.error("Error updating rooftop files", error);
        }
      }
    } catch (error) {
      loggers.bot.error('Error processing batched updates', error);
    }
  }

  // ========== Discord Sync ==========
  async syncUserRolesFromDiscord(
    discordId: string,
    discordRoleIds: string[],
    guildId: string,
  ): Promise<void> {
    return this.discordSync.syncUserRolesFromDiscord(
      discordId,
      discordRoleIds,
      guildId,
      (discordId, guildId) => this.userOps.removeUserFromWhitelistIfNoRoles(discordId, guildId),
    );
  }

  async syncAndPublishAfterVerification(
    discordId: string,
    guildId: string,
    botOverride?: unknown,
  ): Promise<void> {
    return this.discordSync.syncAndPublishAfterVerification(
      discordId,
      botOverride ?? bot,
      (guildId) => this.roleOps.getDiscordRoleMappings(guildId),
      (discordId, roleIds, guildId) => this.syncUserRolesFromDiscord(discordId, roleIds, guildId),
      (discordId, guildId) => this.userOps.getUserByDiscordId(discordId, guildId),
      (discordId, guildId) => this.userOps.getUserWhitelistRoles(discordId, guildId),
      (discordId, commitMessage, guildId) => this.queueBatchedUpdate(discordId, commitMessage, guildId),
      guildId,
    );
  }

  // ========== Statistics ==========
  /**
   * Get statistics, optionally filtered by guild
   */
  async getStatistics(guildId?: string): Promise<{
    totalUsers: number;
    totalRoles: number;
    totalActiveAssignments: number;
    totalExpiredAssignments: number;
  }> {
    const [
      totalUsers,
      totalRoles,
      totalActiveAssignments,
      totalExpiredAssignments,
    ] = await Promise.all([
      prisma.whitelistEntry.count({
        ...(guildId && { where: { guildId } }),
      }),
      prisma.whitelistRole.count({
        ...(guildId && { where: { guildId } }),
      }),
      prisma.whitelistRoleAssignment.count({
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          ...(guildId && {
            role: {
              guildId: guildId,
            },
          }),
        },
      }),
      prisma.whitelistRoleAssignment.count({
        where: {
          expiresAt: { lte: new Date() },
          ...(guildId && {
            role: {
              guildId: guildId,
            },
          }),
        },
      }),
    ]);

    return {
      totalUsers,
      totalRoles,
      totalActiveAssignments,
      totalExpiredAssignments,
    };
  }

  // ========== API Compatibility Methods ==========
  /**
   * Get all whitelist entries (alias for API compatibility)
   */
  async getAllWhitelistEntries(guildId: string): Promise<unknown[]> {
    return this.getWhitelistUsers(guildId);
  }

  /**
   * Bulk import users from CSV content
   */
  async bulkImportUsers(csvContent: string, guildId: string): Promise<{
    imported: number;
    errors: string[];
  }> {
    const lines = csvContent.split("\n").filter((line) => line.trim());
    const results = {
      imported: 0,
      errors: [] as string[],
    };

    for (const line of lines) {
      const [vrchatUsername, roleNames] = line.split(":");
      if (!vrchatUsername) {continue;}

      try {
        // Add user to whitelist
        await this.addUserByVrcUsername(vrchatUsername.trim(), guildId);

        // Assign roles if specified
        if (roleNames) {
          const roles = roleNames.split(",").map((r) => r.trim());
          for (const roleName of roles) {
            try {
              // Note: This needs to be updated to use roleId instead of roleName
              // TODO: Look up role by Discord role ID or other identifier
              loggers.bot.warn(`Role assignment by name is deprecated: ${roleName}`);
            } catch (_error) {
              // Ignore role assignment errors for now
            }
          }
        }

        results.imported++;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.errors.push(`${vrchatUsername}: ${errorMessage}`);
      }
    }

    return results;
  }

  // ========== Cleanup ==========
  /**
   * Cleanup method to clear timers and pending operations
   */
  cleanup(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    // Process any pending updates before shutdown
    if (this.pendingUpdates.size > 0) {
      loggers.bot.info(`Processing ${this.pendingUpdates.size} pending updates before shutdown`);
      this.processBatchedUpdates("Shutdown cleanup").catch((err) => {
        loggers.bot.error("Error processing final updates", err);
      });
    }
  }
}

// Export instance
export const whitelistManager = new WhitelistManager();
