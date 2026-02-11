import { ArgsOf, Discord, On } from "discordx";
import { patrolTimer, prisma, roleTrackingManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
export class RoleTrackingEvents {
  @On({ event: "guildMemberRemove" })
  async onGuildMemberRemove([member]: ArgsOf<"guildMemberRemove">) {
    try {
      const guildId = member.guild.id;
      const userId = member.id;

      // Check if this guild has role tracking configured
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
        select: {
          roleTrackingConfig: true,
        },
      });

      if (!settings?.roleTrackingConfig) {
        // No role tracking configured for this guild
        return;
      }

      // Clean up all role tracking data for this user
      await roleTrackingManager.cleanupUserTracking(guildId, userId);
      loggers.bot.debug(
        `Cleaned up role tracking data for user ${userId} who left guild ${guildId}`,
      );
    } catch (error) {
      loggers.bot.error("Error handling role tracking member remove", error);
    }
  }

  @On({ event: "guildMemberUpdate" })
  async onGuildMemberUpdate([oldMember, newMember]: ArgsOf<"guildMemberUpdate">) {
    try {
      // Check if roles actually changed
      const oldRoles = oldMember.roles.cache;
      const newRoles = newMember.roles.cache;

      if (oldRoles.size === newRoles.size && oldRoles.every((role) => newRoles.has(role.id))) {
        // No role changes
        return;
      }

      const guildId = newMember.guild.id;
      const userId = newMember.id;

      // Get guild settings for role tracking, LOA, and promotion
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
        select: {
          roleTrackingConfig: true,
          loaRoleId: true,
          promotionRules: true,
          promotionRecruitRoleId: true,
          promotionMinHours: true,
        },
      });

      if (!settings) {
        return;
      }

      const config = settings.roleTrackingConfig as Record<string, any> | null;
      const loaRoleId = settings.loaRoleId;

      // Find which roles were added and removed
      const addedRoles = newRoles.filter((role) => !oldRoles.has(role.id));
      const removedRoles = oldRoles.filter((role) => !newRoles.has(role.id));

      // Check if LOA role was added or removed
      if (loaRoleId) {
        const hadLOA = oldRoles.has(loaRoleId);
        const hasLOA = newRoles.has(loaRoleId);

        if (!hadLOA && hasLOA) {
          // LOA role was added - tracking is paused (user will be skipped in scheduled checks)
          loggers.bot.debug(
            `LOA role added for user ${userId} in guild ${guildId} - tracking paused`,
          );
        } else if (hadLOA && !hasLOA) {
          // LOA role was removed - reset all timers
          await roleTrackingManager.handleLOARoleRemoval(guildId, userId);
          loggers.bot.debug(
            `LOA role removed for user ${userId} in guild ${guildId} - all timers reset`,
          );
        }
      }

      // Role-tracking: only if this guild has role tracking configured
      if (config) {
        for (const [roleId, roleConfig] of Object.entries(config)) {
          if (!roleConfig.enabled) {
            continue;
          }

          const roleWasAdded = addedRoles.has(roleId);
          const roleWasRemoved = removedRoles.has(roleId);

          if (roleWasAdded) {
            // Check if user has LOA role - if true, don't track this assignment
            const hasLOA = loaRoleId ? newRoles.has(loaRoleId) : false;

            if (!hasLOA) {
              // Track role assignment
              await roleTrackingManager.trackRoleAssignment(guildId, userId, roleId, new Date());
              loggers.bot.debug(
                `Tracked role assignment: user ${userId}, role ${roleId} in guild ${guildId}`,
              );
            } else {
              loggers.bot.debug(
                `Skipping role assignment tracking for user ${userId}, role ${roleId} in guild ${guildId} - user has LOA role`,
              );
            }
          } else if (roleWasRemoved) {
            // Track role removal (keeps historical record)
            await roleTrackingManager.trackRoleRemoval(guildId, userId, roleId);
            loggers.bot.debug(
              `Tracked role removal: user ${userId}, role ${roleId} in guild ${guildId}`,
            );
          }
        }
      }

      // Promotion: record when user receives a role that is a "current rank" in any promotion rule (for cooldown: hours since obtaining role)
      const rules = patrolTimer.getEffectivePromotionRules(settings);
      if (rules && rules.length > 0) {
        const currentRankIds = new Set(rules.map((r) => r.currentRankRoleId));
        const now = new Date();

        for (const role of addedRoles.values()) {
          if (currentRankIds.has(role.id)) {
            try {
              await prisma.user.upsert({
                where: { discordId: userId },
                create: { discordId: userId },
                update: {},
              });
              await prisma.voicePatrolRoleObtainedAt.upsert({
                where: {
                  guildId_userId_roleId: { guildId, userId, roleId: role.id },
                },
                update: { obtainedAt: now },
                create: { guildId, userId, roleId: role.id, obtainedAt: now },
              });
              loggers.bot.debug(
                `Promotion role obtained: user ${userId}, role ${role.id} in guild ${guildId}`,
              );
            } catch (err) {
              loggers.bot.error("Failed to record promotion role obtained", err);
            }
          }
        }

        for (const role of removedRoles.values()) {
          if (currentRankIds.has(role.id)) {
            try {
              await prisma.voicePatrolRoleObtainedAt.deleteMany({
                where: { guildId, userId, roleId: role.id },
              });
            } catch (err) {
              loggers.bot.error("Failed to delete promotion role obtained record", err);
            }
          }
        }
      }
    } catch (error) {
      loggers.bot.error("Error handling role tracking member update", error);
    }
  }
}
