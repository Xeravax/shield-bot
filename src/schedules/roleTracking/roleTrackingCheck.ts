import { Client } from "discord.js";
import * as cron from "node-cron";
import { loggers } from "../../utility/logger.js";
import { roleTrackingManager } from "../../main.js";
import { prisma } from "../../main.js";

/**
 * Check for users who need warnings and send them
 */
export async function checkRoleTracking(_client: Client): Promise<void> {
  try {
    loggers.schedules.info("Starting role tracking check...");

    // Get all guilds with role tracking configured
    const guildSettings = await prisma.guildSettings.findMany({
      where: {
        roleTrackingConfig: {
          not: null as any,
        },
      },
      select: { guildId: true },
    });

    if (guildSettings.length === 0) {
      loggers.schedules.info("No guilds configured with role tracking");
      return;
    }

    loggers.schedules.info(`Checking role tracking for ${guildSettings.length} guild(s)`);

    // Process each guild
    for (const settings of guildSettings) {
      try {
        await roleTrackingManager.checkAndSendWarnings(settings.guildId);
      } catch (error) {
        loggers.schedules.error(
          `Failed to check role tracking for guild ${settings.guildId}`,
          error,
        );
      }
    }

    loggers.schedules.info("Role tracking check completed");
  } catch (error) {
    loggers.schedules.error("Error in role tracking check", error);
  }
}

/**
 * Initialize the role tracking cron job
 */
export function initializeRoleTrackingSchedule(client: Client): cron.ScheduledTask {
  loggers.schedules.info("Initializing role tracking schedule...");

  // Schedule to run daily at 8 PM UTC
  const job = cron.schedule("0 21 * * *", async () => {
    loggers.schedules.info("Cron job triggered: Role tracking check");
    await checkRoleTracking(client);
  });

  loggers.schedules.info("Role tracking schedule initialized. Will run daily at 8 PM UTC.");
  return job;
}

/**
 * Stop the role tracking cron job
 */
export function stopRoleTrackingSchedule(job: cron.ScheduledTask | null): void {
  if (job) {
    job.stop();
    loggers.schedules.info("Role tracking schedule stopped.");
  }
}
