import {
  Client,
  EmbedBuilder,
  Colors,
  TextChannel,
  MessageCreateOptions,
} from "discord.js";
import { prisma } from "../../main.js";
import { loggers } from "../../utility/logger.js";
import { parseDurationToMs, isValidDuration, msToDurationString } from "../../utility/roleTracking/durationParser.js";
import { patrolTimer } from "../../main.js";

export type ConditionType = "PATROL" | "TIME";

export interface RoleTrackingConfig {
  enabled: boolean;
  roleName: string;
  deadlineDuration: string;
  conditions?: ConditionType[]; // Conditions to check (PATROL, TIME, or both). Defaults to empty array if not set.
  patrolTimeThresholdHours?: number | null;
  warnings: Array<{
    index: number;
    offset: string;
    type: string;
    message: string;
    customMessage?: CustomMessageData;
  }>;
  staffPingOffset: string;
  staffPingMessage: string | CustomMessageData; // Can be string template or embed structure
  customStaffPingMessage?: CustomMessageData;
  staffChannelId?: string | null; // Optional per-role staff channel, falls back to guild setting if not set
  staffPingChannelId?: string | null; // Optional per-role channel for staff pings, falls back to staffChannelId or guild setting
  staffPingRoleIds?: string[] | null; // Optional per-role roles to ping, falls back to guild staff roles if not set
}

export interface RoleTrackingConfigMap {
  [roleId: string]: RoleTrackingConfig;
}

export interface CustomMessageData {
  embeds?: Array<Record<string, unknown>>;
  components?: Array<Record<string, unknown>>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class RoleTrackingManager {
  private client: Client;
  private patrolTimer: typeof patrolTimer;

  constructor(client: Client, patrolTimerManager: typeof patrolTimer) {
    this.client = client;
    this.patrolTimer = patrolTimerManager;
  }

  /**
   * Get or create User by Discord ID and return the User ID
   */
  private async getUserIdFromDiscordId(discordId: string): Promise<number | null> {
    try {
      let user = await prisma.user.findUnique({
        where: { discordId },
      });

      if (!user) {
        // Create user if it doesn't exist
        user = await prisma.user.create({
          data: { discordId },
        });
      }

      return user.id;
    } catch (error) {
      loggers.bot.error(`Failed to get/create user for Discord ID ${discordId}`, error);
      return null;
    }
  }

  /**
   * Track when a user was assigned a tracked role
   */
  async trackRoleAssignment(
    guildId: string,
    discordId: string,
    roleId: string,
    assignedAt?: Date,
  ): Promise<void> {
    try {
      const userId = await this.getUserIdFromDiscordId(discordId);
      if (!userId) {
        loggers.bot.error(`Failed to get User ID for Discord ID ${discordId}`);
        return;
      }

      const assignmentDate = assignedAt || new Date();
      await prisma.roleAssignmentTracking.upsert({
        where: {
          guildId_userId_roleId: {
            guildId,
            userId,
            roleId,
          },
        },
        update: {
          assignedAt: assignmentDate,
          updatedAt: new Date(),
        },
        create: {
          guildId,
          userId,
          roleId,
          assignedAt: assignmentDate,
        },
      });
    } catch (error) {
      loggers.bot.error(
        `Failed to track role assignment for user ${discordId}, role ${roleId} in guild ${guildId}`,
        error,
      );
    }
  }

  /**
   * Track when a tracked role is removed
   * Removes role assignment tracking and all warnings - user is fully reset
   * Uses cascade delete for warnings linked to assignment tracking
   */
  async trackRoleRemoval(guildId: string, discordId: string, roleId: string): Promise<void> {
    try {
      const userId = await this.getUserIdFromDiscordId(discordId);
      if (!userId) {
        loggers.bot.error(`Failed to get User ID for Discord ID ${discordId}`);
        return;
      }

      // Remove role assignment tracking record (cascade delete will remove linked warnings)
      await prisma.roleAssignmentTracking.deleteMany({
        where: {
          guildId,
          userId,
          roleId,
        },
      });


      loggers.bot.info(
        `Removed role tracking assignment and all warnings for user ${discordId}, role ${roleId} in guild ${guildId} - user fully reset`,
      );
    } catch (error) {
      loggers.bot.error(
        `Failed to remove role tracking data for user ${discordId}, role ${roleId} in guild ${guildId}`,
        error,
      );
    }
  }

  /**
   * Handle LOA role removal - reset all timers for this user
   * Also removes all warnings so user starts fresh
   */
  async handleLOARoleRemoval(guildId: string, discordId: string): Promise<void> {
    try {
      const userId = await this.getUserIdFromDiscordId(discordId);
      if (!userId) {
        loggers.bot.error(`Failed to get User ID for Discord ID ${discordId}`);
        return;
      }

      // Remove all warnings for this user (they'll start fresh after LOA)
      await prisma.roleTrackingWarning.deleteMany({
        where: {
          guildId,
          userId,
        },
      });

      const now = new Date();
      await prisma.roleAssignmentTracking.updateMany({
        where: {
          guildId,
          userId,
        },
        data: {
          assignedAt: now,
          updatedAt: now,
        },
      });
      loggers.bot.info(
        `Reset all role assignment timers for user ${discordId} in guild ${guildId} due to LOA removal`,
      );
    } catch (error) {
      loggers.bot.error(
        `Failed to reset role assignment timers for user ${discordId} in guild ${guildId}`,
        error,
      );
    }
  }

  /**
   * Get role assignment date, or system init date if no record exists
   */
  async getRoleAssignmentDate(
    guildId: string,
    discordId: string,
    roleId: string,
    systemInitDate: Date,
  ): Promise<Date> {
    const userId = await this.getUserIdFromDiscordId(discordId);
    if (!userId) {
      return systemInitDate;
    }

    const tracking = await prisma.roleAssignmentTracking.findUnique({
      where: {
        guildId_userId_roleId: {
          guildId,
          userId,
          roleId,
        },
      },
    });

    if (tracking) {
      return tracking.assignedAt;
    }

    // No record exists (existing user when system was first enabled)
    return systemInitDate;
  }

  /**
   * Check if user has LOA role
   */
  async hasLOARole(guildId: string, userId: string): Promise<boolean> {
    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
        select: { loaRoleId: true },
      });

      if (!settings?.loaRoleId) {
        return false;
      }

      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        return false;
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return false;
      }

      return member.roles.cache.has(settings.loaRoleId);
    } catch (error) {
      loggers.bot.error(`Failed to check LOA role for user ${userId} in guild ${guildId}`, error);
      return false;
    }
  }

  /**
   * Get patrol time in a specific period
   */
  async getUserPatrolTimeInPeriod(
    guildId: string,
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    try {
      // Get start and end dates in UTC
      const startYear = startDate.getUTCFullYear();
      const startMonth = startDate.getUTCMonth() + 1;
      const endYear = endDate.getUTCFullYear();
      const endMonth = endDate.getUTCMonth() + 1;

      let totalMs = 0;

      // Get all monthly records between start and end dates
      const monthlyRecords = await prisma.voicePatrolMonthlyTime.findMany({
        where: {
          guildId,
          userId,
          OR: [
            // Records that fall entirely within the period
            {
              year: { gte: startYear },
              month: { gte: startMonth },
            },
            {
              year: { lte: endYear },
              month: { lte: endMonth },
            },
          ],
        },
      });

      // Sum up all relevant monthly records
      for (const record of monthlyRecords) {
        const recordStart = new Date(Date.UTC(record.year, record.month - 1, 1));
        const recordEnd = new Date(Date.UTC(record.year, record.month, 0, 23, 59, 59, 999));

        // Only count if record overlaps with our period
        if (recordStart <= endDate && recordEnd >= startDate) {
          totalMs += Number(record.totalMs);
        }
      }

      // Add live delta from PatrolTimerManager if we're in the current month
      const now = new Date();
      if (now >= startDate && now <= endDate) {
        const currentYear = now.getUTCFullYear();
        const currentMonth = now.getUTCMonth() + 1;

        // Get user's current patrol time for the current month
        const currentMonthTotal = await this.patrolTimer.getUserTotalForMonth(
          guildId,
          userId,
          currentYear,
          currentMonth,
        );

        // Subtract what we already counted from monthly records
        const existingRecord = monthlyRecords.find(
          (r) => r.year === currentYear && r.month === currentMonth,
        );

        if (existingRecord) {
          // Replace with live total
          totalMs -= Number(existingRecord.totalMs);
        }
        totalMs += currentMonthTotal;
      }

      return totalMs;
    } catch (error) {
      loggers.bot.error(
        `Failed to get patrol time for user ${userId} in guild ${guildId} from ${startDate.toISOString()} to ${endDate.toISOString()}`,
        error,
      );
      return 0;
    }
  }

  /**
   * Check if patrol time threshold is met
   */
  async checkPatrolTimeThreshold(
    guildId: string,
    userId: string,
    _roleId: string,
    roleConfig: RoleTrackingConfig,
    assignmentDate: Date,
  ): Promise<boolean> {
    // If no threshold is set, return false (warn only if patrol time is zero)
    if (!roleConfig.patrolTimeThresholdHours) {
      loggers.bot.debug(
        `[RoleTracking] No patrol threshold set for user ${userId} in guild ${guildId}`,
      );
      return false;
    }

    const now = new Date();
    const patrolTimeMs = await this.getUserPatrolTimeInPeriod(
      guildId,
      userId,
      assignmentDate,
      now,
    );

    const patrolTimeHours = patrolTimeMs / (1000 * 60 * 60);
    const thresholdMet = patrolTimeHours >= roleConfig.patrolTimeThresholdHours;
    
    loggers.bot.debug(
      `[RoleTracking] Threshold check for user ${userId}: ${patrolTimeHours.toFixed(2)}/${roleConfig.patrolTimeThresholdHours} hours, met=${thresholdMet}`,
    );
    
    return thresholdMet;
  }

  /**
   * Check all conditions for a role assignment
   * Returns true if ALL conditions pass, false if ANY condition fails
   */
  async checkAllConditions(
    guildId: string,
    userId: string,
    roleId: string,
    roleConfig: RoleTrackingConfig,
    assignmentDate: Date,
  ): Promise<{ allPassed: boolean; failedConditions: ConditionType[] }> {
    const conditions = roleConfig.conditions || [];
    
    // If no conditions specified, all conditions pass (no tracking)
    if (conditions.length === 0) {
      loggers.bot.debug(
        `[RoleTracking] No conditions specified for user ${userId}, role ${roleId} - all conditions pass`,
      );
      return {
        allPassed: true,
        failedConditions: [],
      };
    }
    
    const conditionsToCheck = conditions;
    
    loggers.bot.debug(
      `[RoleTracking] Checking conditions for user ${userId}, role ${roleId}: [${conditionsToCheck.join(", ")}]`,
    );
    
    const failedConditions: ConditionType[] = [];
    
    // Check PATROL condition
    if (conditionsToCheck.includes("PATROL")) {
      const patrolThresholdMet = await this.checkPatrolTimeThreshold(
        guildId,
        userId,
        roleId,
        roleConfig,
        assignmentDate,
      );
      
      if (!patrolThresholdMet) {
        failedConditions.push("PATROL");
        loggers.bot.debug(
          `[RoleTracking] PATROL condition failed for user ${userId}`,
        );
      } else {
        loggers.bot.debug(
          `[RoleTracking] PATROL condition passed for user ${userId}`,
        );
      }
    }
    
    // Check TIME condition
    if (conditionsToCheck.includes("TIME")) {
      const now = new Date();
      const deadlineMs = parseDurationToMs(roleConfig.deadlineDuration);
      
      if (deadlineMs) {
        const timeSinceAssignment = now.getTime() - assignmentDate.getTime();
        // TIME condition passes if we haven't exceeded the deadline
        if (timeSinceAssignment >= deadlineMs) {
          failedConditions.push("TIME");
          loggers.bot.debug(
            `[RoleTracking] TIME condition failed for user ${userId} (time since: ${msToDurationString(timeSinceAssignment)}, deadline: ${msToDurationString(deadlineMs)})`,
          );
        } else {
          loggers.bot.debug(
            `[RoleTracking] TIME condition passed for user ${userId} (time since: ${msToDurationString(timeSinceAssignment)}, deadline: ${msToDurationString(deadlineMs)})`,
          );
        }
      }
    }
    
    loggers.bot.debug(
      `[RoleTracking] Condition check result for user ${userId}: allPassed=${failedConditions.length === 0}, failedConditions=[${failedConditions.join(", ")}]`,
    );
    
    return {
      allPassed: failedConditions.length === 0,
      failedConditions,
    };
  }

  /**
   * Remove warnings for a user-role-assignment combination
   */
  async removeWarningsForUser(
    guildId: string,
    discordId: string,
    roleId: string,
    assignmentTrackingId?: number,
  ): Promise<void> {
    try {
      const userId = await this.getUserIdFromDiscordId(discordId);
      if (!userId) {
        loggers.bot.debug(
          `[RoleTracking] Cannot remove warnings for user ${discordId} - user ID not found`,
        );
        return;
      }

      const where: {
        guildId: string;
        userId: number;
        roleId: string;
        assignmentTrackingId?: number;
      } = {
        guildId,
        userId,
        roleId,
      };

      if (assignmentTrackingId) {
        where.assignmentTrackingId = assignmentTrackingId;
        loggers.bot.debug(
          `[RoleTracking] Removing warnings for user ${discordId}, role ${roleId}, assignmentTrackingId ${assignmentTrackingId}`,
        );
      } else {
        loggers.bot.debug(
          `[RoleTracking] Removing all warnings for user ${discordId}, role ${roleId}`,
        );
      }

      const deletedCount = await prisma.roleTrackingWarning.deleteMany({
        where,
      });

      loggers.bot.debug(
        `[RoleTracking] Removed ${deletedCount.count} warning(s) for user ${discordId}, role ${roleId}`,
      );
    } catch (error) {
      loggers.bot.error(
        `Failed to remove warnings for user ${discordId}, role ${roleId} in guild ${guildId}`,
        error,
      );
    }
  }

  /**
   * Cleanup warnings for users who have left the server
   */
  async cleanupWarningsForMissingUsers(guildId: string): Promise<number> {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        return 0;
      }

      // Get all unique user IDs from warnings and assignment tracking
      const warnings = await prisma.roleTrackingWarning.findMany({
        where: { guildId },
        select: { userId: true },
        distinct: ["userId"],
      });

      const assignments = await prisma.roleAssignmentTracking.findMany({
        where: { guildId },
        select: { userId: true },
        distinct: ["userId"],
      });

      const allUserIds = new Set<number>();
      for (const w of warnings) {
        allUserIds.add(w.userId);
      }
      for (const a of assignments) {
        allUserIds.add(a.userId);
      }

      let cleanupCount = 0;

      // Check each user to see if they still exist in the guild
      for (const userId of allUserIds) {
        try {
          // Get user to find discordId
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { discordId: true },
          });

          if (!user) {
            // User not found in database, clean up
            await prisma.roleTrackingWarning.deleteMany({
              where: { guildId, userId },
            });
            await prisma.roleAssignmentTracking.deleteMany({
              where: { guildId, userId },
            });
            cleanupCount++;
            continue;
          }

          // Check if user exists in guild
          try {
            await guild.members.fetch(user.discordId);
            // User exists, skip
          } catch {
            // User doesn't exist or has left - clean up their records
            await prisma.roleTrackingWarning.deleteMany({
              where: { guildId, userId },
            });
            await prisma.roleAssignmentTracking.deleteMany({
              where: { guildId, userId },
            });
            cleanupCount++;
          }
        } catch {
          // Error fetching user or member - clean up
          await prisma.roleTrackingWarning.deleteMany({
            where: { guildId, userId },
          });
          await prisma.roleAssignmentTracking.deleteMany({
            where: { guildId, userId },
          });
          cleanupCount++;
        }
      }

      if (cleanupCount > 0) {
        loggers.bot.info(
          `Cleaned up ${cleanupCount} users' role tracking data for guild ${guildId}`,
        );
      }

      return cleanupCount;
    } catch (error) {
      loggers.bot.error(
        `Failed to cleanup warnings for missing users in guild ${guildId}`,
        error,
      );
      return 0;
    }
  }

  /**
   * Check if user has received a specific warning
   * Checks by assignmentTrackingId if available to prevent duplicates when assignment date changes
   */
  async hasReceivedWarning(
    guildId: string,
    discordId: string,
    roleId: string,
    warningIndex: number,
    roleAssignedAt: Date,
    assignmentTrackingId?: number,
  ): Promise<boolean> {
    try {
      const userId = await this.getUserIdFromDiscordId(discordId);
      if (!userId) {
        loggers.bot.debug(
          `[RoleTracking] Cannot check warning for user ${discordId} - user ID not found`,
        );
        return false;
      }

      // If assignmentTrackingId is provided, check by that to prevent duplicates
      // when assignment date changes (e.g., LOA reset)
      if (assignmentTrackingId) {
        const warning = await prisma.roleTrackingWarning.findFirst({
          where: {
            guildId,
            userId,
            roleId,
            warningIndex,
            assignmentTrackingId,
          },
        });
        const hasReceived = !!warning;
        loggers.bot.debug(
          `[RoleTracking] Warning check for user ${discordId}, warningIndex ${warningIndex}, assignmentTrackingId ${assignmentTrackingId}: ${hasReceived ? "found" : "not found"}`,
        );
        return hasReceived;
      }

      // Fallback to checking by roleAssignedAt for backward compatibility
      const warning = await prisma.roleTrackingWarning.findFirst({
        where: {
          guildId,
          userId,
          roleId,
          warningIndex,
          roleAssignedAt,
        },
      });

      const hasReceived = !!warning;
      loggers.bot.debug(
        `[RoleTracking] Warning check for user ${discordId}, warningIndex ${warningIndex}, roleAssignedAt ${roleAssignedAt.toISOString()}: ${hasReceived ? "found" : "not found"}`,
      );
      return hasReceived;
    } catch (error) {
      loggers.bot.error(
        `Failed to check warning for user ${discordId}, role ${roleId} in guild ${guildId}`,
        error,
      );
      return false;
    }
  }

  /**
   * Record that a warning was sent
   */
  async recordWarningSent(
    guildId: string,
    discordId: string,
    roleId: string,
    warningType: string,
    warningIndex: number,
    roleAssignedAt: Date,
    assignmentTrackingId?: number,
  ): Promise<void> {
    try {
      const userId = await this.getUserIdFromDiscordId(discordId);
      if (!userId) {
        loggers.bot.error(`Failed to get User ID for Discord ID ${discordId}`);
        return;
      }

      await prisma.roleTrackingWarning.create({
        data: {
          guildId,
          userId,
          roleId,
          warningType,
          warningIndex,
          sentAt: new Date(),
          roleAssignedAt,
          assignmentTrackingId: assignmentTrackingId || null,
        },
      });
    } catch (error) {
      loggers.bot.error(
        `Failed to record warning for user ${discordId}, role ${roleId} in guild ${guildId}`,
        error,
      );
    }
  }

  /**
   * Send warning DM to user
   */
  async sendWarningDM(
    userId: string,
    message: string | CustomMessageData,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await this.client.users.fetch(userId);
      
      // If message is an object with embeds/components, send as message payload
      if (typeof message === "object" && (message.embeds || message.components)) {
        // Cast to MessageCreateOptions - Discord.js will validate at runtime
        await user.send(message as unknown as MessageCreateOptions);
      } else {
        // Otherwise send as plain text
        await user.send(message as string);
      }
      
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Log to staff channel with optional ping
   * @param guildId - Guild ID
   * @param embed - Embed to send
   * @param shouldPing - Whether to ping staff roles
   * @param roleChannelId - Optional role-specific channel ID. If not provided, falls back to guild setting.
   * @param rolePingRoleIds - Optional role-specific roles to ping. If not provided, falls back to guild staff roles.
   */
  async logToStaffChannel(
    guildId: string,
    embed: EmbedBuilder,
    shouldPing: boolean,
    roleChannelId?: string | null,
    rolePingRoleIds?: string[] | null,
  ): Promise<void> {
    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
        select: { roleTrackingStaffChannelId: true, staffRoleIds: true },
      });

      // Use role-specific channel if provided, otherwise fall back to guild setting
      const channelId = roleChannelId || settings?.roleTrackingStaffChannelId;

      if (!channelId) {
        loggers.bot.debug(
          `No role tracking staff channel configured for guild ${guildId}`,
        );
        return;
      }

      const channel = (await this.client.channels.fetch(
        channelId,
      )) as TextChannel;

      if (!channel || !channel.isTextBased()) {
        loggers.bot.warn(
          `Invalid role tracking staff channel ${channelId} for guild ${guildId}`,
        );
        return;
      }

      // Use role-specific ping roles if provided, otherwise fall back to guild staff roles
      const pingRoleIds = rolePingRoleIds || (Array.isArray(settings?.staffRoleIds) ? (settings.staffRoleIds as string[]) : []);

      // Build content with staff ping if needed
      let content = "";
      if (shouldPing && pingRoleIds.length > 0) {
        const roleMentions = pingRoleIds.map((id) => `<@&${id}>`).join(" ");
        content = `${roleMentions}\n`;
      } else if (shouldPing) {
        content = "@here\n";
      }

      // Send full embed with proper structure (title, description, fields, etc.)
      const allowedMentions = shouldPing && pingRoleIds.length > 0
        ? { roles: pingRoleIds }
        : { roles: [] };

      await channel.send({
        content: content || undefined,
        embeds: [embed],
        allowedMentions,
      });

      loggers.bot.info(
        `Logged role tracking message to staff channel for guild ${guildId}`,
      );
    } catch (error) {
      loggers.bot.error(
        `Failed to log to staff channel for guild ${guildId}`,
        error,
      );
    }
  }

  /**
   * Send custom message to staff channel with optional ping
   * @param guildId - Guild ID
   * @param message - Custom message data (embeds/components) or string
   * @param shouldPing - Whether to ping staff roles
   * @param roleChannelId - Optional role-specific channel ID. If not provided, falls back to guild setting.
   * @param rolePingRoleIds - Optional role-specific roles to ping. If not provided, falls back to guild staff roles.
   */
  async sendCustomMessageToStaffChannel(
    guildId: string,
    message: string | CustomMessageData,
    shouldPing: boolean,
    roleChannelId?: string | null,
    rolePingRoleIds?: string[] | null,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
        select: { roleTrackingStaffChannelId: true, staffRoleIds: true },
      });

      // Use role-specific channel if provided, otherwise fall back to guild setting
      const channelId = roleChannelId || settings?.roleTrackingStaffChannelId;

      if (!channelId) {
        loggers.bot.debug(
          `No role tracking staff channel configured for guild ${guildId}`,
        );
        return { success: false, error: "No staff channel configured" };
      }

      const channel = (await this.client.channels.fetch(
        channelId,
      )) as TextChannel;

      if (!channel || !channel.isTextBased()) {
        loggers.bot.warn(
          `Invalid role tracking staff channel ${channelId} for guild ${guildId}`,
        );
        return { success: false, error: "Invalid channel" };
      }

      // Use role-specific ping roles if provided, otherwise fall back to guild staff roles
      const pingRoleIds = rolePingRoleIds || (Array.isArray(settings?.staffRoleIds) ? (settings.staffRoleIds as string[]) : []);

      // Build content with staff ping if needed
      let content = "";
      if (shouldPing && pingRoleIds.length > 0) {
        const roleMentions = pingRoleIds.map((id) => `<@&${id}>`).join(" ");
        content = `${roleMentions}\n`;
      } else if (shouldPing) {
        content = "@here\n";
      }

      const allowedMentions = shouldPing && pingRoleIds.length > 0
        ? { roles: pingRoleIds }
        : { roles: [] };

      // If message is an object with embeds/components, send as message payload
      if (typeof message === "object" && (message.embeds || message.components)) {
        // Prepend ping content if needed
        const messagePayload: MessageCreateOptions = {
          ...(message as MessageCreateOptions),
          content: content + ((message as MessageCreateOptions).content || ""),
          allowedMentions,
        };
        await channel.send(messagePayload);
      } else {
        // Otherwise send as plain text with ping
        await channel.send({
          content: content + (message as string),
          allowedMentions,
        });
      }

      loggers.bot.info(
        `Sent custom message to staff channel for guild ${guildId}`,
      );
      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      loggers.bot.error(
        `Failed to send custom message to staff channel for guild ${guildId}`,
        error,
      );
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Validate role tracking configuration
   */
  validateRoleTrackingConfig(roleConfig: RoleTrackingConfig): ValidationResult {
    const errors: string[] = [];

    // Validate conditions (optional - empty array means no conditions/tracking)
    if (roleConfig.conditions !== undefined) {
      if (!Array.isArray(roleConfig.conditions)) {
        errors.push("conditions must be an array");
      } else if (roleConfig.conditions.length > 0) {
        const validConditions: ConditionType[] = ["PATROL", "TIME"];
        for (const condition of roleConfig.conditions) {
          if (!validConditions.includes(condition)) {
            errors.push(`Invalid condition: "${condition}". Must be one of: ${validConditions.join(", ")}`);
          }
        }
        
        // If PATROL condition is used, patrolTimeThresholdHours must be set
        if (roleConfig.conditions.includes("PATROL")) {
          if (roleConfig.patrolTimeThresholdHours === null || roleConfig.patrolTimeThresholdHours === undefined) {
            errors.push("patrolTimeThresholdHours must be set when using PATROL condition");
          }
        }
      }
      // Empty array is valid - means no conditions/tracking
    }

    // Validate deadline duration
    if (!isValidDuration(roleConfig.deadlineDuration)) {
      errors.push(`Invalid deadlineDuration: "${roleConfig.deadlineDuration}"`);
    }

    const deadlineMs = parseDurationToMs(roleConfig.deadlineDuration);
    if (!deadlineMs) {
      errors.push(`Could not parse deadlineDuration: "${roleConfig.deadlineDuration}"`);
    }

    // Validate staff ping offset
    if (!isValidDuration(roleConfig.staffPingOffset)) {
      errors.push(`Invalid staffPingOffset: "${roleConfig.staffPingOffset}"`);
    }

    const staffPingMs = parseDurationToMs(roleConfig.staffPingOffset);
    if (!staffPingMs) {
      errors.push(`Could not parse staffPingOffset: "${roleConfig.staffPingOffset}"`);
    }

    // Validate threshold
    if (roleConfig.patrolTimeThresholdHours !== null && roleConfig.patrolTimeThresholdHours !== undefined) {
      if (roleConfig.patrolTimeThresholdHours < 0) {
        errors.push("patrolTimeThresholdHours must be a positive number");
      }
    }

    // Validate warnings
    const warningOffsets: number[] = [];
    for (let i = 0; i < roleConfig.warnings.length; i++) {
      const warning = roleConfig.warnings[i];

      // Validate offset
      if (!isValidDuration(warning.offset)) {
        errors.push(`Invalid warning offset at index ${i}: "${warning.offset}"`);
      } else {
        const offsetMs = parseDurationToMs(warning.offset);
        if (offsetMs) {
          warningOffsets.push(offsetMs);

          // Check if offset exceeds deadline
          if (deadlineMs && offsetMs > deadlineMs) {
            errors.push(
              `Warning offset "${warning.offset}" at index ${i} exceeds deadlineDuration "${roleConfig.deadlineDuration}"`,
            );
          }
        }
      }

      // Validate index matches array position
      if (warning.index !== i) {
        errors.push(
          `Warning index ${warning.index} at array position ${i} does not match`,
        );
      }
    }

    // Check if warning offsets are in ascending order
    for (let i = 1; i < warningOffsets.length; i++) {
      if (warningOffsets[i] < warningOffsets[i - 1]) {
        errors.push(
          `Warning offsets must be in ascending order. Offset at index ${i} is before offset at index ${i - 1}`,
        );
      }
    }

    // Check if staff ping offset exceeds deadline
    if (deadlineMs && staffPingMs && staffPingMs > deadlineMs) {
      errors.push(
        `staffPingOffset "${roleConfig.staffPingOffset}" exceeds deadlineDuration "${roleConfig.deadlineDuration}"`,
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Parse message template with placeholders
   */
  parseMessageTemplate(
    template: string,
    variables: Record<string, string | number>,
  ): string {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
      // Escape special regex characters in the key (but not curly braces)
      const escapedKey = key.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
      // Create placeholder pattern: {key} - escape curly braces for regex literal match
      const placeholder = `\\{${escapedKey}\\}`;
      // Replace all occurrences of {key} with the value
      result = result.replace(new RegExp(placeholder, "g"), String(value));
    }

    return result;
  }

  /**
   * Parse embed template with placeholders (recursively processes all string values)
   */
  parseEmbedTemplate(
    template: CustomMessageData,
    variables: Record<string, string | number>,
  ): CustomMessageData {
    const parseString = (str: string): string => {
      let result = str;
      for (const [key, value] of Object.entries(variables)) {
        const escapedKey = key.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
        const placeholder = `\\{${escapedKey}\\}`;
        result = result.replace(new RegExp(placeholder, "g"), String(value));
      }
      return result;
    };

    const parseObject = (obj: unknown): unknown => {
      if (typeof obj === "string") {
        return parseString(obj);
      } else if (Array.isArray(obj)) {
        return obj.map(parseObject);
      } else if (obj !== null && typeof obj === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = parseObject(value);
        }
        return result;
      }
      return obj;
    };

    return parseObject(template) as CustomMessageData;
  }

  /**
   * Check and send warnings for all configured roles in a guild
   */
  async checkAndSendWarnings(guildId: string): Promise<void> {
    try {
      loggers.bot.debug(`[RoleTracking] Starting check for guild ${guildId}`);

      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
      });

      if (!settings || !settings.roleTrackingConfig) {
        loggers.bot.debug(
          `[RoleTracking] No role tracking config found for guild ${guildId}`,
        );
        return;
      }

      const config = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};
      const systemInitDate = settings?.roleTrackingInitializedAt || new Date();

      const enabledRoles = Object.entries(config).filter(([_, roleConfig]) => roleConfig.enabled);
      loggers.bot.debug(
        `[RoleTracking] Found ${enabledRoles.length} enabled role(s) to check in guild ${guildId}`,
      );

      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        loggers.bot.debug(`[RoleTracking] Guild ${guildId} not found in cache`);
        return;
      }

      // First, cleanup warnings for users who have left
      loggers.bot.debug(`[RoleTracking] Cleaning up warnings for users who have left guild ${guildId}`);
      await this.cleanupWarningsForMissingUsers(guildId);

      // Process each configured role
      for (const [roleId, roleConfig] of Object.entries(config)) {
        if (!roleConfig.enabled) {
          loggers.bot.debug(`[RoleTracking] Skipping disabled role ${roleId}`);
          continue;
        }

        loggers.bot.debug(
          `[RoleTracking] Processing role ${roleId} (${roleConfig.roleName})`,
        );

        // Get all members with this role
        const role = guild.roles.cache.get(roleId);
        if (!role) {
          loggers.bot.debug(`[RoleTracking] Role ${roleId} not found in guild`);
          continue;
        }

        const members = role.members;
        loggers.bot.debug(
          `[RoleTracking] Found ${members.size} member(s) with role ${roleId}`,
        );

        for (const member of members.values()) {
          try {
            loggers.bot.debug(
              `[RoleTracking] Processing user ${member.id} for role ${roleId} in guild ${guildId}`,
            );

            // Check if user has LOA role - if true, skip entirely
            if (await this.hasLOARole(guildId, member.id)) {
              loggers.bot.debug(
                `[RoleTracking] User ${member.id} has LOA role, skipping role tracking`,
              );
              continue;
            }

            // Get role assignment date (member.id is discordId)
            const assignmentDate = await this.getRoleAssignmentDate(
              guildId,
              member.id, // discordId
              roleId,
              systemInitDate,
            );

            loggers.bot.debug(
              `[RoleTracking] User ${member.id} role ${roleId} assigned at: ${assignmentDate.toISOString()}`,
            );

            // Get assignment tracking record (needed for warning removal and tracking)
            const userId = await this.getUserIdFromDiscordId(member.id);
            if (!userId) {
              loggers.bot.warn(`Failed to get User ID for member ${member.id} in guild ${guildId}`);
              continue;
            }

            const assignmentTracking = await prisma.roleAssignmentTracking.findUnique({
              where: {
                guildId_userId_roleId: {
                  guildId,
                  userId,
                  roleId,
                },
              },
            });

            loggers.bot.debug(
              `[RoleTracking] Assignment tracking ID for user ${member.id}: ${assignmentTracking?.id || "none"}`,
            );

            // If no conditions are configured, skip tracking entirely
            const activeConditions = roleConfig.conditions || [];
            if (activeConditions.length === 0) {
              loggers.bot.debug(
                `[RoleTracking] No conditions configured for user ${member.id}, skipping role tracking`,
              );
              continue;
            }

            // Check all conditions - but don't skip warnings based on condition status
            // Warnings should be sent at their scheduled intervals regardless of condition status
            // Conditions are only used to determine:
            // 1. Whether to remove warnings (when requirements are met, like patrol threshold)
            // 2. Whether to send staff ping (when deadline exceeded)
            const conditionCheck = await this.checkAllConditions(
              guildId,
              member.id,
              roleId,
              roleConfig,
              assignmentDate,
            );

            loggers.bot.debug(
              `[RoleTracking] Condition check for user ${member.id}: allPassed=${conditionCheck.allPassed}, failedConditions=[${conditionCheck.failedConditions.join(", ")}]`,
            );

            // Note: We don't skip warning processing here even if allPassed is true
            // TIME condition "passing" just means deadline not exceeded - warnings should still be sent at intervals
            // Warnings will be processed below, and condition status will be used later for:
            // - Removing warnings if patrol threshold is met
            // - Sending staff ping if deadline is exceeded

            // Get patrol time in period
            const now = new Date();
            const patrolTimeMs = await this.getUserPatrolTimeInPeriod(
              guildId,
              member.id,
              assignmentDate,
              now,
            );

            const patrolTimeHours = patrolTimeMs / (1000 * 60 * 60);

            loggers.bot.debug(
              `[RoleTracking] User ${member.id} patrol time: ${patrolTimeHours.toFixed(2)} hours (${msToDurationString(patrolTimeMs)})`,
            );

            // Calculate time since role assignment
            const timeSinceAssignment = now.getTime() - assignmentDate.getTime();
            const deadlineMs = parseDurationToMs(roleConfig.deadlineDuration);
            if (!deadlineMs) {
              loggers.bot.warn(
                `Invalid deadline duration for role ${roleId} in guild ${guildId}`,
              );
              continue;
            }

            const timeSinceAssignmentStr = msToDurationString(timeSinceAssignment);
            loggers.bot.debug(
              `[RoleTracking] User ${member.id} time since assignment: ${timeSinceAssignmentStr}, deadline: ${msToDurationString(deadlineMs)}`,
            );

            // Check which conditions are active
            const conditions = roleConfig.conditions || [];
            const conditionsToCheck = conditions;
            const hasPatrolCondition = conditionsToCheck.includes("PATROL");

            // Only check patrol threshold if PATROL is an active condition
            // If only TIME is active, PATROL cannot be satisfied, so warnings shouldn't be removed
            let patrolThresholdMet = false;
            let skipWarningsDueToThreshold = false;
            if (hasPatrolCondition) {
              patrolThresholdMet = await this.checkPatrolTimeThreshold(
                guildId,
                member.id,
                roleId,
                roleConfig,
                assignmentDate,
              );

              loggers.bot.debug(
                `[RoleTracking] Patrol threshold check for user ${member.id}: met=${patrolThresholdMet}, threshold=${roleConfig.patrolTimeThresholdHours || "not set"} hours`,
              );

              if (patrolThresholdMet) {
                loggers.bot.debug(
                  `[RoleTracking] Threshold met for user ${member.id}, removing warnings to reset to 0`,
                );
                // Threshold met - remove warnings so user starts back at 0
                await this.removeWarningsForUser(
                  guildId,
                  member.id,
                  roleId,
                  assignmentTracking?.id,
                );
                // Skip sending warnings since threshold is met
                skipWarningsDueToThreshold = true;
                // Skip staff ping if threshold is met (will be checked later)
              }
            } else {
              loggers.bot.debug(
                `[RoleTracking] PATROL condition not active for user ${member.id}, skipping patrol threshold check`,
              );
            }

            // Check each warning to see if it should be sent
            // Skip if patrol threshold is met (warnings were already removed)
            if (skipWarningsDueToThreshold) {
              loggers.bot.debug(
                `[RoleTracking] Skipping warning checks for user ${member.id} - patrol threshold met`,
              );
            } else {
              for (const warning of roleConfig.warnings) {
              const warningOffsetMs = parseDurationToMs(warning.offset);
              if (!warningOffsetMs) {
                loggers.bot.debug(
                  `[RoleTracking] Invalid warning offset for warning #${warning.index}: ${warning.offset}`,
                );
                continue;
              }

              // Check if we're past this warning's offset
              if (timeSinceAssignment >= warningOffsetMs) {
                loggers.bot.debug(
                  `[RoleTracking] Checking warning #${warning.index} for user ${member.id} (offset: ${msToDurationString(warningOffsetMs)}, time since: ${msToDurationString(timeSinceAssignment)})`,
                );

                // Check if this warning has already been sent (member.id is discordId)
                const hasReceived = await this.hasReceivedWarning(
                  guildId,
                  member.id, // discordId
                  roleId,
                  warning.index,
                  assignmentDate,
                  assignmentTracking?.id,
                );

                loggers.bot.debug(
                  `[RoleTracking] Warning #${warning.index} for user ${member.id}: hasReceived=${hasReceived}`,
                );

                if (!hasReceived) {
                  loggers.bot.info(
                    `[RoleTracking] Sending warning #${warning.index} to user ${member.id} (not previously recorded - will attempt DM)`,
                  );
                  // Calculate time remaining for logging (always needed)
                  const timeRemainingMs = deadlineMs - timeSinceAssignment;
                  const timeRemaining = msToDurationString(timeRemainingMs);

                  // Send warning
                  let messageToSend: string | CustomMessageData;
                  
                  // Calculate deadline date for variables
                  const deadlineDate = new Date(
                    assignmentDate.getTime() + deadlineMs,
                  );
                  const deadlineTimestamp = Math.floor(deadlineDate.getTime() / 1000);

                  // Prepare variables for template parsing
                  const warningVariables = {
                    roleName: roleConfig.roleName,
                    timeRemaining,
                    deadlineDate: `<t:${deadlineTimestamp}:D>`, // Date only (e.g., "April 20, 2021")
                    deadlineDateTime: `<t:${deadlineTimestamp}:f>`, // Full date/time (e.g., "Tuesday, April 20, 2021 4:20 PM")
                    deadlineTimestamp: `<t:${deadlineTimestamp}:R>`, // Relative time (e.g., "in 2 hours")
                    patrolTime: Math.floor(patrolTimeMs),
                    patrolTimeHours: patrolTimeHours.toFixed(1),
                    patrolTimeFormatted: msToDurationString(patrolTimeMs),
                  };
                  
                  // Use custom message from warning config if provided, otherwise use template
                  if (warning.customMessage) {
                    messageToSend = this.parseEmbedTemplate(warning.customMessage, warningVariables);
                  } else {
                    messageToSend = this.parseMessageTemplate(warning.message, warningVariables);
                  }

                  const dmResult = await this.sendWarningDM(member.id, messageToSend);

                  // Only record warning if DM was successfully sent
                  if (dmResult.success) {
                    await this.recordWarningSent(
                      guildId,
                      member.id,
                      roleId,
                      "warning",
                      warning.index,
                      assignmentDate,
                      assignmentTracking?.id,
                    );
                    loggers.bot.debug(
                      `[RoleTracking] Warning #${warning.index} recorded for user ${member.id} - DM sent successfully`,
                    );
                  } else {
                    loggers.bot.warn(
                      `[RoleTracking] Warning #${warning.index} NOT recorded for user ${member.id} - DM failed: ${dmResult.error}`,
                    );
                  }

                  // Log to staff channel without ping
                  const logEmbedFields = [
                    { name: "User", value: `<@${member.id}>`, inline: true },
                    { name: "Role", value: roleConfig.roleName, inline: true },
                    {
                      name: "Warning",
                      value: `#${warning.index + 1} (${warning.offset})`,
                      inline: true,
                    },
                  ];

                  // Only add Patrol Time if PATROL condition is active
                  if (hasPatrolCondition) {
                    logEmbedFields.push({
                      name: "Patrol Time",
                      value: `${patrolTimeHours.toFixed(1)} hours`,
                      inline: true,
                    });
                  }

                  // Always add Time Remaining and DM Status (shown for both TIME and PATROL conditions)
                  logEmbedFields.push(
                    {
                      name: "Time Remaining",
                      value: timeRemaining,
                      inline: true,
                    },
                    {
                      name: "DM Status",
                      value: dmResult.success ? "✅ Sent" : `❌ Failed: ${dmResult.error}`,
                      inline: true,
                    },
                  );

                  const embedTitle = dmResult.success 
                    ? `⚠️ Role Tracking Warning Sent`
                    : `⚠️ Role Tracking Warning Failed`;
                  const embedDescription = dmResult.success
                    ? `Warning #${warning.index + 1} sent to <@${member.id}> for role **${roleConfig.roleName}**`
                    : `Warning #${warning.index + 1} failed to send to <@${member.id}> for role **${roleConfig.roleName}** - DM failed: ${dmResult.error}`;

                  const logEmbed = new EmbedBuilder()
                    .setTitle(embedTitle)
                    .setDescription(embedDescription)
                    .addFields(logEmbedFields)
                    .setColor(dmResult.success ? Colors.Orange : Colors.Red)
                    .setTimestamp();

                  await this.logToStaffChannel(guildId, logEmbed, false, roleConfig.staffChannelId);
                }
              }
            }
            } // End of else block for warning processing

            // Check if staff ping should be sent (skip if PATROL condition is active and threshold is met)
            // If PATROL is not active, always check staff ping regardless of patrol time
            if (!hasPatrolCondition || !patrolThresholdMet) {
              loggers.bot.debug(
                `[RoleTracking] Checking staff ping for user ${member.id} (threshold not met, checking ping requirement)`,
              );
              const staffPingOffsetMs = parseDurationToMs(roleConfig.staffPingOffset);
              if (staffPingOffsetMs && timeSinceAssignment >= staffPingOffsetMs) {
                loggers.bot.debug(
                  `[RoleTracking] Staff ping offset reached for user ${member.id} (offset: ${msToDurationString(staffPingOffsetMs)}, time since: ${msToDurationString(timeSinceAssignment)})`,
                );

                const hasReceivedPing = await this.hasReceivedWarning(
                  guildId,
                  member.id,
                  roleId,
                  -1, // Use -1 for staff ping
                  assignmentDate,
                  assignmentTracking?.id,
                );

                loggers.bot.debug(
                  `[RoleTracking] Staff ping check for user ${member.id}: hasReceivedPing=${hasReceivedPing}`,
                );

              if (!hasReceivedPing) {
                loggers.bot.debug(
                  `[RoleTracking] Sending staff ping for user ${member.id}`,
                );
                let messageToSend: string | CustomMessageData;
                
                // Calculate comprehensive user information
                const timeSinceAssignmentMs = timeSinceAssignment;
                const timeSinceAssignmentStr = msToDurationString(timeSinceAssignmentMs);
                const deadlineDate = new Date(assignmentDate.getTime() + deadlineMs);
                const timeOverdue = timeSinceAssignmentMs - deadlineMs;
                const timeOverdueStr = timeOverdue > 0 ? msToDurationString(timeOverdue) : "0 seconds";
                const patrolTimeFormatted = msToDurationString(patrolTimeMs);
                const thresholdMet = roleConfig.patrolTimeThresholdHours 
                  ? patrolTimeHours >= roleConfig.patrolTimeThresholdHours 
                  : null;
                const thresholdStatus = thresholdMet === null 
                  ? "N/A" 
                  : thresholdMet 
                    ? "✅ Met" 
                    : "❌ Not Met";
                const thresholdDisplay = roleConfig.patrolTimeThresholdHours 
                  ? `${roleConfig.patrolTimeThresholdHours} hours (${thresholdStatus})`
                  : "Not set";
                
                // Calculate inactivity time (time since assignment minus patrol time)
                // This represents time they haven't been patrolling
                const inactivityTimeMs = Math.max(0, timeSinceAssignmentMs - patrolTimeMs);
                const inactivityTimeStr = msToDurationString(inactivityTimeMs);
                const inactivityPercentage = timeSinceAssignmentMs > 0 
                  ? ((inactivityTimeMs / timeSinceAssignmentMs) * 100).toFixed(1)
                  : "0.0";
                
                // Prepare all available variables
                const deadlineTimestamp = Math.floor(deadlineDate.getTime() / 1000);
                const assignmentTimestamp = Math.floor(assignmentDate.getTime() / 1000);
                
                const variables = {
                  userMention: `<@${member.id}>`,
                  userId: member.id,
                  userName: member.displayName || member.user.username,
                  roleName: roleConfig.roleName,
                  roleId: roleId,
                  patrolTimeHours: patrolTimeHours.toFixed(2),
                  patrolTimeFormatted: patrolTimeFormatted,
                  patrolTimeMs: Math.floor(patrolTimeMs).toString(),
                  timeSinceAssignment: timeSinceAssignmentStr,
                  timeSinceAssignmentMs: Math.floor(timeSinceAssignmentMs).toString(),
                  assignmentDate: `<t:${assignmentTimestamp}:D>`, // Date only
                  assignmentDateTime: `<t:${assignmentTimestamp}:f>`, // Full date/time
                  assignmentTimestamp: `<t:${assignmentTimestamp}:R>`, // Relative time
                  deadlineDate: `<t:${deadlineTimestamp}:D>`, // Date only (e.g., "April 20, 2021")
                  deadlineDateTime: `<t:${deadlineTimestamp}:f>`, // Full date/time (e.g., "Tuesday, April 20, 2021 4:20 PM")
                  deadlineTimestamp: `<t:${deadlineTimestamp}:R>`, // Relative time (e.g., "in 2 hours")
                  deadlineDuration: roleConfig.deadlineDuration,
                  timeOverdue: timeOverdueStr,
                  timeOverdueMs: Math.floor(Math.max(0, timeOverdue)).toString(),
                  thresholdHours: roleConfig.patrolTimeThresholdHours?.toString() || "Not set",
                  thresholdDisplay: thresholdDisplay,
                  thresholdStatus: thresholdStatus,
                  inactivityTime: inactivityTimeStr,
                  inactivityTimeMs: Math.floor(inactivityTimeMs).toString(),
                  inactivityPercentage: inactivityPercentage,
                  timestamp: new Date().toISOString(),
                };
                
                // Use custom message from role config if provided, otherwise use template
                if (roleConfig.customStaffPingMessage) {
                  messageToSend = this.parseEmbedTemplate(roleConfig.customStaffPingMessage, variables);
                } else if (typeof roleConfig.staffPingMessage === "string") {
                  // Legacy string template
                  messageToSend = this.parseMessageTemplate(roleConfig.staffPingMessage, variables);
                } else {
                  // Embed template
                  messageToSend = this.parseEmbedTemplate(roleConfig.staffPingMessage, variables);
                }

                // Send custom message to staff channel (not to user)
                const shouldPing = process.env.NODE_ENV === "production";
                // Use role-specific ping channel if set, otherwise fall back to staffChannelId or guild setting
                const pingChannelId = roleConfig.staffPingChannelId || roleConfig.staffChannelId;
                const staffChannelResult = await this.sendCustomMessageToStaffChannel(
                  guildId,
                  messageToSend,
                  shouldPing,
                  pingChannelId,
                  roleConfig.staffPingRoleIds || undefined,
                );

                // Record staff ping
                await this.recordWarningSent(
                  guildId,
                  member.id,
                  roleId,
                  "staff_ping",
                  -1,
                  assignmentDate,
                  assignmentTracking?.id,
                );

                // Log to staff channel WITH ping (fallback embed if custom message failed)
                if (!staffChannelResult.success) {
                  const logEmbedFields = [
                    { name: "User", value: `<@${member.id}>`, inline: true },
                    { name: "Role", value: roleConfig.roleName, inline: true },
                  ];

                  // Only add Patrol Time if PATROL condition is active
                  if (hasPatrolCondition) {
                    logEmbedFields.push({
                      name: "Patrol Time",
                      value: `${patrolTimeHours.toFixed(1)} hours`,
                      inline: true,
                    });
                  }

                  logEmbedFields.push({
                    name: "Message Status",
                    value: staffChannelResult.success ? "✅ Sent" : `❌ Failed: ${staffChannelResult.error}`,
                    inline: true,
                  });

                  const logEmbed = new EmbedBuilder()
                    .setTitle(`🚨 Role Tracking Deadline Reached`)
                    .setDescription(
                      `Staff ping: <@${member.id}> has reached the deadline for role **${roleConfig.roleName}**`,
                    )
                    .addFields(logEmbedFields)
                    .setColor(Colors.Red)
                    .setTimestamp();

                  // Use role-specific ping channel and roles if set
                  const pingChannelId = roleConfig.staffPingChannelId || roleConfig.staffChannelId;
                  await this.logToStaffChannel(guildId, logEmbed, shouldPing, pingChannelId, roleConfig.staffPingRoleIds || undefined);
                }
              } else {
                loggers.bot.debug(
                  `[RoleTracking] Staff ping already sent for user ${member.id}, skipping`,
                );
              }
            } else if (staffPingOffsetMs) {
              loggers.bot.debug(
                `[RoleTracking] Staff ping offset not reached for user ${member.id} (offset: ${msToDurationString(staffPingOffsetMs)}, time since: ${msToDurationString(timeSinceAssignment)})`,
              );
            } else {
              loggers.bot.debug(
                `[RoleTracking] No staff ping offset configured for user ${member.id}`,
              );
            }
            } else {
              loggers.bot.debug(
                `[RoleTracking] Skipping staff ping for user ${member.id} - PATROL condition active and threshold met`,
              );
            }
          } catch (error) {
            loggers.bot.error(
              `Error processing user ${member.id} for role ${roleId} in guild ${guildId}`,
              error,
            );
          }
        }
      }

      loggers.bot.debug(`[RoleTracking] Completed check for guild ${guildId}`);
    } catch (error) {
      loggers.bot.error(`Error checking and sending warnings for guild ${guildId}`, error);
    }
  }
}
