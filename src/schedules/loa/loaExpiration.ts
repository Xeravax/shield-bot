import { Client } from "discord.js";
import * as cron from "node-cron";
import { loggers } from "../../utility/logger.js";
import { loaManager } from "../../main.js";

/**
 * Check for expired LOAs and remove roles
 */
export async function checkLOAExpiration(_client: Client): Promise<void> {
  try {
    loggers.schedules.info("Starting LOA expiration check...");

    // Activate approved LOAs that have reached their start date
    await loaManager.activateApprovedLOAs();

    // Get expired LOAs
    const expiredLOAs = await loaManager.getExpiredLOAs();

    if (expiredLOAs.length === 0) {
      loggers.schedules.info("No expired LOAs found");
      return;
    }

    loggers.schedules.info(`Found ${expiredLOAs.length} expired LOA(s)`);

    // Process each expired LOA
    for (const loa of expiredLOAs) {
      try {
        const result = await loaManager.expireLOA(loa.id);

        if (result.success) {
          loggers.schedules.info(
            `Expired LOA ${loa.id} for user ${loa.user.discordId} in guild ${loa.guildId}`,
          );
        } else {
          loggers.schedules.warn(
            `Failed to expire LOA ${loa.id} for user ${loa.user.discordId}: ${result.error}`,
          );
        }
      } catch (error) {
        loggers.schedules.error(`Error processing expired LOA ${loa.id}`, error);
      }
    }

    loggers.schedules.info("LOA expiration check completed");
  } catch (error) {
    loggers.schedules.error("Error in LOA expiration check", error);
  }
}

/**
 * Initialize the LOA expiration cron job
 */
export function initializeLOAExpirationSchedule(client: Client): cron.ScheduledTask {
  loggers.schedules.info("Initializing LOA expiration schedule...");

  // Schedule to run every hour
  const job = cron.schedule("0 * * * *", async () => {
    loggers.schedules.info("Cron job triggered: LOA expiration check");
    await checkLOAExpiration(client);
  });

  loggers.schedules.info("LOA expiration schedule initialized. Will run every hour.");
  return job;
}

/**
 * Stop the LOA expiration cron job
 */
export function stopLOAExpirationSchedule(job: cron.ScheduledTask | null): void {
  if (job) {
    job.stop();
    loggers.schedules.info("LOA expiration schedule stopped.");
  }
}
