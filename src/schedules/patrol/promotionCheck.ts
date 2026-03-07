import { Client, GuildMember } from "discord.js";
import * as cron from "node-cron";
import { loggers } from "../../utility/logger.js";
import { prisma, patrolTimer } from "../../main.js";

/**
 * Run promotion check for all eligible members in all configured guilds.
 * Called daily at 10 AM UTC.
 */
export async function checkPromotions(client: Client): Promise<void> {
  try {
    loggers.schedules.info("Starting promotion check...");

    const guildSettings = await prisma.guildSettings.findMany({
      where: { promotionChannelId: { not: null } },
      select: { guildId: true, promotionRules: true },
    });

    const rulesByGuild = guildSettings.filter((s) => {
      const rules = patrolTimer.getEffectivePromotionRules(s);
      return rules && rules.length > 0;
    });

    if (rulesByGuild.length === 0) {
      loggers.schedules.info("No guilds configured with promotion channel and rules");
      return;
    }

    loggers.schedules.info(`Checking promotions for ${rulesByGuild.length} guild(s)`);

    for (const settings of rulesByGuild) {
      try {
        const guild = await client.guilds.fetch(settings.guildId).catch(() => null);
        if (!guild) {
          loggers.schedules.warn(`Guild ${settings.guildId} not found`);
          continue;
        }

        const rules = patrolTimer.getEffectivePromotionRules(settings);
        if (!rules || rules.length === 0) {
          continue;
        }

        const currentRankIds = [...new Set(rules.map((r) => r.currentRankRoleId))];
        const membersToCheck = new Map<string, GuildMember>();

        for (const roleId of currentRankIds) {
          const role = await guild.roles.fetch(roleId).catch(() => null);
          if (!role) {
            continue;
          }
          for (const [, member] of role.members) {
            if (!member.user.bot) {
              membersToCheck.set(member.id, member);
            }
          }
        }

        let sentCount = 0;
        for (const member of membersToCheck.values()) {
          const sent = await patrolTimer.runPromotionCheckForMember(settings.guildId, member);
          if (sent) {
            sentCount++;
          }
        }

        if (membersToCheck.size > 0) {
          loggers.schedules.info(
            `Promotion check guild ${settings.guildId}: ${membersToCheck.size} member(s), ${sentCount} notification(s) sent`,
          );
        }
      } catch (error) {
        loggers.schedules.error(
          `Failed to check promotions for guild ${settings.guildId}`,
          error,
        );
      }
    }

    loggers.schedules.info("Promotion check completed");
  } catch (error) {
    loggers.schedules.error("Error in promotion check", error);
  }
}

/**
 * Initialize the promotion check cron job (daily at 10 AM UTC).
 */
export function initializePromotionCheckSchedule(client: Client): cron.ScheduledTask {
  loggers.schedules.info("Initializing promotion check schedule...");

  const job = cron.schedule(
    "0 10 * * *",
    async () => {
      loggers.schedules.info("Cron job triggered: Promotion check");
      await checkPromotions(client);
    },
    { timezone: "UTC" },
  );

  loggers.schedules.info("Promotion check schedule initialized. Will run daily at 10 AM UTC.");
  return job;
}

/**
 * Stop the promotion check cron job.
 */
export function stopPromotionCheckSchedule(job: cron.ScheduledTask | null): void {
  if (job) {
    job.stop();
    loggers.schedules.info("Promotion check schedule stopped.");
  }
}
