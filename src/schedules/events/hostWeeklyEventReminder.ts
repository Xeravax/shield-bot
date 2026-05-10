import {
  bold,
  Client,
  ContainerBuilder,
  hyperlink,
  inlineCode,
  italic,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  time,
  TimestampStyles,
} from "discord.js";
import * as cron from "node-cron";
import { loggers } from "../../utility/logger.js";
import { prisma } from "../../main.js";

/** Roles to ping at the start of the weekly host event reminder. */
const HOST_EVENT_REMINDER_PING_ROLE_IDS = [
  "814554774052536373",
  "842897800286306304",
] as const;

function buildPingContent(): string {
  return HOST_EVENT_REMINDER_PING_ROLE_IDS.map((id) => `<@&${id}>`).join(" ");
}

function buildReminderContainer(): ContainerBuilder {
  const pings = buildPingContent();
  const exampleTs = time(
    Math.floor(Date.now() / 1000),
    TimestampStyles.LongDateTime,
  );

  const intro = new TextDisplayBuilder().setContent(
    [
      pings,
      "",
      "# Weekly event scheduling reminder",
      "",
      `Hello ${bold("Hosts")} and ${bold("Jr. Hosts")} — time to get events on the calendar.`,
      "",
      "You have until **Monday** to prepare and schedule your events for the week. The sooner they’re posted, the easier it is for members to plan.",
    ].join("\n"),
  );

  const sep1 = new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Large);

  const rules = new TextDisplayBuilder().setContent(
    [
      "## Reminders",
      "",
      "● **Mondays are planning-only** — do not schedule events on Mondays.",
      "",
      "● **Per-host limits** — at most **3 on-duty** and **3 off-duty** events.",
      "",
      "● **No overlap** — keep at least **1–2 hours** between event start times.",
    ].join("\n"),
  );

  const sep2 = new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Large);

  const times = new TextDisplayBuilder().setContent(
    [
      "## Clear times for every timezone",
      "",
      "Prefer tools that show **one instant** in each user’s local time:",
      "",
      `● **Use ${inlineCode("@time")}** — in the message box, type ${inlineCode("@")}, select **time** / timestamp, and pick the date & time. Discord inserts a stamp everyone sees in their own timezone.`,
      "",
      `● **Manual format** — ${inlineCode("<t:UNIX_SECONDS:F>")} (full date & time). Example for “right now”: ${exampleTs}`,
      "",
      `● **Helpers** — ${hyperlink("guacamolie.nl/timestamp", "https://guacamolie.nl/timestamp")} · ${hyperlink("r.3v.fi/discord-timestamps", "https://r.3v.fi/discord-timestamps/")}`,
      "",
      italic(
        "If you skip timestamps entirely, state times in **EST** so people can convert the same way.",
      ),
    ].join("\n"),
  );

  const sep3 = new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Large);

  const closing = new TextDisplayBuilder().setContent(
    [
      "## Jr. Hosts",
      "",
      "**Jr. Hosts need a full Host as co-host** for any event they run — **no solo Jr. events.**",
      "",
      "Thanks for keeping the schedule tight — have a great rest of your day or night!",
    ].join("\n"),
  );

  return new ContainerBuilder()
    .setAccentColor(0x3498db)
    .addTextDisplayComponents(intro)
    .addSeparatorComponents(sep1)
    .addTextDisplayComponents(rules)
    .addSeparatorComponents(sep2)
    .addTextDisplayComponents(times)
    .addSeparatorComponents(sep3)
    .addTextDisplayComponents(closing);
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

    const container = buildReminderContainer();

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

        await channel.send({
          allowedMentions: { roles: [...HOST_EVENT_REMINDER_PING_ROLE_IDS] },
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
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
