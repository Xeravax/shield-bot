import { ArgsOf, Discord, On } from "discordx";
import { prisma, roleTrackingManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
export class RoleTrackingEvents {
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

      // Get guild settings to check for tracked roles and LOA role
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
        select: {
          roleTrackingConfig: true,
          loaRoleId: true,
        },
      });

      if (!settings?.roleTrackingConfig) {
        // No role tracking configured for this guild
        return;
      }

      const config = settings.roleTrackingConfig as Record<string, any>;
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

      // Check if any tracked roles were added
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
    } catch (error) {
      loggers.bot.error("Error handling role tracking member update", error);
    }
  }
}
