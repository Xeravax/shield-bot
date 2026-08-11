import { Client } from "discord.js";
import * as cron from "node-cron";
import { loggers } from "../../utility/logger.js";
import { modCaseManager } from "../../main.js";

export async function runTempBanExpiry(_client: Client): Promise<void> {
  try {
    loggers.schedules.info("Starting temp ban expiry check...");
    const processed = await modCaseManager.expireTempBans();
    loggers.schedules.info(`Temp ban expiry complete: ${processed} unban(s)`);
  } catch (error) {
    loggers.schedules.error("Temp ban expiry failed", error);
  }
}

export function initializeTempBanExpirySchedule(
  client: Client,
): cron.ScheduledTask {
  loggers.schedules.info("Initializing temp ban expiry schedule...");
  const job = cron.schedule("*/15 * * * *", async () => {
    await runTempBanExpiry(client);
  });
  void runTempBanExpiry(client);
  return job;
}

export function stopTempBanExpirySchedule(
  job: cron.ScheduledTask | null,
): void {
  if (job) {
    job.stop();
    loggers.schedules.info("Temp ban expiry schedule stopped.");
  }
}
