import { Client } from "discord.js";
import * as cron from "node-cron";
import { loggers } from "../../utility/logger.js";
import { serverStatsManager } from "../../main.js";

/**
 * Refresh all configured server stats channels.
 */
export async function refreshServerStatsChannels(_client: Client): Promise<void> {
  try {
    loggers.schedules.info("Starting server stats channel refresh...");
    await serverStatsManager.updateAllConfiguredGuilds();
    loggers.schedules.info("Server stats channel refresh completed");
  } catch (error) {
    loggers.schedules.error("Error in server stats channel refresh", error);
  }
}

/**
 * Initialize the server stats refresh cron job (every 10 minutes).
 */
export function initializeServerStatsSchedule(client: Client): cron.ScheduledTask {
  loggers.schedules.info("Initializing server stats schedule...");

  const job = cron.schedule("*/10 * * * *", async () => {
    loggers.schedules.info("Cron job triggered: Server stats refresh");
    await refreshServerStatsChannels(client);
  }, {
    timezone: "UTC",
  });

  loggers.schedules.info(
    "Server stats schedule initialized. Running once on startup, then every 10 minutes.",
  );
  void refreshServerStatsChannels(client);
  return job;
}

/**
 * Stop the server stats refresh cron job.
 */
export function stopServerStatsSchedule(job: cron.ScheduledTask | null): void {
  if (job) {
    job.stop();
    loggers.schedules.info("Server stats schedule stopped.");
  }
}
