import { Client } from "discord.js";
import * as cron from "node-cron";
import { loggers } from "../../utility/logger.js";
import { prisma } from "../../main.js";

/** Roles to ping at the start of the weekly host event reminder. */
const HOST_EVENT_REMINDER_PING_ROLE_IDS = [
  "814554774052536373",
  "842897800286306304",
] as const;

function buildHostWeeklyEventReminderContent(): string {
  const pings = HOST_EVENT_REMINDER_PING_ROLE_IDS.map((id) => `<@&${id}>`).join(
    " ",
  );
  return `${pings}
Hello Host and Jr. hosts, it's time to do some events! You have until Monday to prepare and schedule your events, so  let's get them flowing!

Your reminders are as follows:

● Events cannot be scheduled on Mondays due to that day being a planning day.

● Hosts are allowed 3 on-duty and 3 off-duty events maximum.

● Events must have 1-2 hour gaps between each other at minimum to prevent overlaps.

● You're welcome to use https://guacamolie.nl/timestamp or https://r.3v.fi/discord-timestamps/ if you need help with time zone conversions, or if you wanna be more precise for everyone. If you don't use any of those, please be sure that your time is in EST.

● Jr. Hosts must have a full-time host as a co-host for their event if they are planning to host one. Jr. Hosts cannot host alone!

Other than that, have a good rest of your day and or night!`;
}

/**
 * Post the weekly host / Jr. host event reminder to all configured channels.
 */
export async function broadcastHostWeeklyEventReminder(client: Client): Promise<void> {
  try {
    loggers.schedules.info("Starting host weekly event reminder job...");

    const guildSettings = await prisma.guildSettings.findMany({
      where: {
        hostWeeklyEventReminderChannelId: { not: null },
      },
    });

    if (guildSettings.length === 0) {
      loggers.schedules.info(
        "No guilds configured with hostWeeklyEventReminderChannelId",
      );
      return;
    }

    const content = buildHostWeeklyEventReminderContent();

    loggers.schedules.info(
      `Posting host weekly event reminder to ${guildSettings.length} guild(s)`,
    );

    for (const settings of guildSettings) {
      const channelId = settings.hostWeeklyEventReminderChannelId;
      if (!channelId || !settings.guildId) {
        continue;
      }

      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased() || channel.isDMBased()) {
          loggers.schedules.warn(
            `Invalid host weekly event reminder channel ${channelId} for guild ${settings.guildId}`,
          );
          continue;
        }

        await channel.send({ content, allowedMentions: {} });
        loggers.schedules.info(
          `Posted host weekly event reminder to channel ${channelId} in guild ${settings.guildId}`,
        );
      } catch (error) {
        loggers.schedules.error(
          `Failed to post host weekly event reminder for guild ${settings.guildId}`,
          error,
        );
      }
    }

    loggers.schedules.info("Host weekly event reminder job completed");
  } catch (error) {
    loggers.schedules.error("Error in host weekly event reminder job", error);
  }
}

/**
 * Thursday 15:00 Europe/Amsterdam (CET/CEST).
 */
export function initializeHostWeeklyEventReminderSchedule(
  client: Client,
): cron.ScheduledTask {
  loggers.schedules.info("Initializing host weekly event reminder schedule...");

  const job = cron.schedule(
    "0 15 * * 4",
    async () => {
      loggers.schedules.info("Cron job triggered: Host weekly event reminder");
      await broadcastHostWeeklyEventReminder(client);
    },
    { timezone: "Europe/Amsterdam" },
  );

  loggers.schedules.info(
    "Host weekly event reminder schedule initialized. Will run Thursdays at 15:00 Europe/Amsterdam.",
  );
  return job;
}

export function stopHostWeeklyEventReminderSchedule(
  job: cron.ScheduledTask | null,
): void {
  if (job) {
    job.stop();
    loggers.schedules.info("Host weekly event reminder schedule stopped.");
  }
}
