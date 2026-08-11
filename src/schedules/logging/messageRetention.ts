import { Client } from "discord.js";
import * as cron from "node-cron";
import { loggers } from "../../utility/logger.js";
import { messageArchiveManager } from "../../main.js";

export async function runMessageArchiveRetention(_client: Client): Promise<void> {
  try {
    loggers.schedules.info("Starting message archive retention purge...");
    const result = await messageArchiveManager.purgeExpired();
    loggers.schedules.info(
      `Retention purge complete: ${result.messages} cached messages, ${result.archives} purge archives`,
    );
  } catch (error) {
    loggers.schedules.error("Message archive retention failed", error);
  }
}

export function initializeMessageArchiveRetentionSchedule(
  client: Client,
): cron.ScheduledTask {
  loggers.schedules.info("Initializing message archive retention schedule...");
  const job = cron.schedule("15 3 * * *", async () => {
    loggers.schedules.info("Cron job triggered: message archive retention");
    await runMessageArchiveRetention(client);
  });
  void runMessageArchiveRetention(client);
  return job;
}

export function stopMessageArchiveRetentionSchedule(
  job: cron.ScheduledTask | null,
): void {
  if (job) {
    job.stop();
    loggers.schedules.info("Message archive retention schedule stopped.");
  }
}
