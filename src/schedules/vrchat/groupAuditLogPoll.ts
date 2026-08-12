import { Client } from "discord.js";
import * as cron from "node-cron";
import { loggers } from "../../utility/logger.js";
import { groupAuditLogManager } from "../../managers/vrchat/groupAuditLogManager.js";

let auditPollInFlight: Promise<void> | null = null;

export async function runGroupAuditLogPoll(_client: Client): Promise<void> {
  if (auditPollInFlight) {
    loggers.schedules.info("Skipping overlapping VRChat group audit poll");
    return;
  }

  auditPollInFlight = (async () => {
    try {
      loggers.schedules.debug("Starting VRChat group audit log poll...");
      await groupAuditLogManager.pollAllGuilds();
      loggers.schedules.debug("VRChat group audit log poll complete");
    } catch (error) {
      loggers.schedules.error("VRChat group audit log poll failed", error);
    }
  })().finally(() => {
    auditPollInFlight = null;
  });

  await auditPollInFlight;
}

export function initializeGroupAuditLogPollSchedule(
  client: Client,
): cron.ScheduledTask {
  loggers.schedules.info("Initializing VRChat group audit log poll schedule...");
  // Every 2 minutes
  const job = cron.schedule("*/2 * * * *", async () => {
    await runGroupAuditLogPoll(client);
  });
  void runGroupAuditLogPoll(client);
  return job;
}

export function stopGroupAuditLogPollSchedule(
  job: cron.ScheduledTask | null,
): void {
  if (job) {
    job.stop();
    loggers.schedules.info("VRChat group audit log poll schedule stopped.");
  }
}
