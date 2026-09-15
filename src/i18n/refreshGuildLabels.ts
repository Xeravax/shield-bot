import type { DiscordLocale } from "./discordLocales.js";
import { t } from "./index.js";
import { prisma } from "../main.js";
import { loggers } from "../utility/logger.js";
import {
  formatServerStatsChannelName,
  type ServerStatsKind,
} from "../managers/serverStats/serverStatsManager.js";
import {
  LOGGING_THREAD_KEYS,
  type LoggingThreadKey,
} from "../managers/logging/loggingTypes.js";

/**
 * Refresh guild-owned Discord labels after locale change
 * (server-stats voice channel names + logging forum thread names).
 */
export async function refreshGuildLocaleLabels(
  guildId: string,
  locale: DiscordLocale,
): Promise<void> {
  try {
    const { bot } = await import("../main.js");
    const guild = await bot.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      return;
    }

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId },
    });
    if (!settings) {
      return;
    }

    // Server stats channel names — keep numeric value from current name when possible
    const statsKinds: {
      kind: ServerStatsKind;
      field:
        | "serverStatsGoalChannelId"
        | "serverStatsMembersChannelId"
        | "serverStatsDeputiesChannelId"
        | "serverStatsBoostsChannelId";
    }[] = [
      { kind: "goal", field: "serverStatsGoalChannelId" },
      { kind: "members", field: "serverStatsMembersChannelId" },
      { kind: "deputies", field: "serverStatsDeputiesChannelId" },
      { kind: "boosts", field: "serverStatsBoostsChannelId" },
    ];

    for (const { kind, field } of statsKinds) {
      const channelId = settings[field];
      if (!channelId) continue;
      try {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !("setName" in channel)) continue;
        const match = channel.name.match(/:\s*(\d+)\s*$/);
        const value = match ? Number(match[1]) : 0;
        const newName = formatServerStatsChannelName(kind, value, locale);
        if (channel.name !== newName) {
          await channel.setName(newName);
        }
      } catch (err) {
        loggers.bot.debug("Failed to rename server-stats channel on locale change", {
          guildId,
          kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Logging forum thread names
    const threadIds = (settings.loggingThreadIds ?? {}) as Partial<
      Record<LoggingThreadKey, string>
    >;
    for (const key of LOGGING_THREAD_KEYS) {
      const threadId = threadIds[key];
      if (!threadId) continue;
      try {
        const thread = await guild.channels.fetch(threadId).catch(() => null);
        if (!thread || !("setName" in thread)) continue;
        const newName = t(locale, `logging.threads.${key}`);
        if (thread.name !== newName) {
          await thread.setName(newName);
        }
      } catch (err) {
        loggers.bot.debug("Failed to rename logging thread on locale change", {
          guildId,
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (error) {
    loggers.bot.warn("refreshGuildLocaleLabels failed", error);
  }
}
