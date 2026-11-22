import { Client } from "discord.js";
import * as cron from "node-cron";
import { prisma } from "../../main.js";
import { whitelistManager } from "../../managers/whitelist/whitelistManager.js";
import { getUserById } from "../../utility/vrchat/user.js";
import { loggers } from "../../utility/logger.js";

// Display names normally arrive through the VRChat websocket (friend-update), but only for
// friends of the bot account. This sweep catches everyone else, a few accounts per run so the
// VRChat API is not hammered: with 10 per 10-minute run, ~1400 accounts are checked per day.
const NAME_REFRESH_BATCH_SIZE = 10;
const NAME_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let maintenanceInFlight: Promise<void> | null = null;

async function refreshStaleUsernames(): Promise<{ checked: number; changed: number }> {
  const cutoff = new Date(Date.now() - NAME_MAX_AGE_MS);
  const accounts = await prisma.vRChatAccount.findMany({
    where: {
      accountType: { in: ["MAIN", "ALT"] },
      OR: [{ usernameUpdatedAt: null }, { usernameUpdatedAt: { lt: cutoff } }],
    },
    select: { id: true, vrcUserId: true },
    orderBy: { usernameUpdatedAt: "asc" },
    take: NAME_REFRESH_BATCH_SIZE,
  });

  let changed = 0;
  for (const account of accounts) {
    try {
      const info = (await getUserById(account.vrcUserId)) as
        | { displayName?: string; username?: string }
        | null;
      const name = info?.displayName || info?.username;
      if (!name) {
        // Account not found: mark it checked so it does not hold a slot in every run.
        loggers.schedules.warn(`Whitelist name refresh: VRChat user ${account.vrcUserId} not found`);
        await prisma.vRChatAccount.update({
          where: { id: account.id },
          data: { usernameUpdatedAt: new Date() },
        });
        continue;
      }
      if (await whitelistManager.applyVrchatDisplayName(account.vrcUserId, name, "scheduled refresh")) {
        changed++;
      }
    } catch (error) {
      loggers.schedules.warn(`Whitelist name refresh failed for ${account.vrcUserId}`, error);
    }
  }
  return { checked: accounts.length, changed };
}

export async function runWhitelistMaintenance(_client: Client): Promise<void> {
  if (maintenanceInFlight) {
    loggers.schedules.info("Skipping overlapping whitelist maintenance run");
    return;
  }

  maintenanceInFlight = (async () => {
    try {
      const expired = await whitelistManager.expireRolesAndPublish();
      const names = await refreshStaleUsernames();
      if (expired > 0 || names.changed > 0) {
        loggers.schedules.info(
          `Whitelist maintenance: ${expired} expired role(s) removed, ${names.changed}/${names.checked} name(s) changed`,
        );
      } else {
        loggers.schedules.debug(`Whitelist maintenance: nothing to do (${names.checked} name(s) checked)`);
      }
    } catch (error) {
      loggers.schedules.error("Whitelist maintenance failed", error);
    }
  })().finally(() => {
    maintenanceInFlight = null;
  });

  await maintenanceInFlight;
}

export function initializeWhitelistMaintenanceSchedule(client: Client): cron.ScheduledTask {
  loggers.schedules.info("Initializing whitelist maintenance schedule...");
  // Every 10 minutes. No run at startup: the VRChat session may not be logged in yet.
  return cron.schedule("*/10 * * * *", async () => {
    await runWhitelistMaintenance(client);
  });
}

export function stopWhitelistMaintenanceSchedule(job: cron.ScheduledTask | null): void {
  if (job) {
    job.stop();
    loggers.schedules.info("Whitelist maintenance schedule stopped.");
  }
}
