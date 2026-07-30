import { Get, Router } from "@discordx/koa";
import type { Context } from "koa";
import {
  buildGuildDiscordEventCalendar,
  buildHostPlannedEventCalendar,
} from "../../managers/events/discordEventCalendarFeed.js";
import { loggers } from "../../utility/logger.js";

const ICS_CACHE_TTL_MS = 300_000;

type IcsCacheEntry = {
  ics: string;
  etag: string;
  expiresAt: number;
};

const icsCache = new Map<string, IcsCacheEntry>();

function getCachedIcs(key: string): { ics: string; etag: string } | null {
  const entry = icsCache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() >= entry.expiresAt) {
    icsCache.delete(key);
    return null;
  }
  return { ics: entry.ics, etag: entry.etag };
}

function setCachedIcs(key: string, feed: { ics: string; etag: string }): void {
  icsCache.set(key, {
    ...feed,
    expiresAt: Date.now() + ICS_CACHE_TTL_MS,
  });
}

function sendIcs(
  ctx: Context,
  feed: { ics: string; etag: string },
  filename: string,
): void {
  if (ctx.headers["if-none-match"] === feed.etag) {
    ctx.status = 304;
    return;
  }

  ctx.set("Content-Type", "text/calendar; charset=utf-8");
  ctx.set("Content-Disposition", `inline; filename="${filename}"`);
  ctx.set("Cache-Control", "public, max-age=300");
  ctx.set("ETag", feed.etag);
  ctx.body = feed.ics;
}

@Router()
export class EventsCalendarAPI {
  @Get("/api/events/:guildId/calendar.ics")
  async getCalendarIcs(ctx: Context) {
    try {
      const guildId = ctx.params.guildId;
      if (!guildId || typeof guildId !== "string") {
        ctx.status = 400;
        ctx.body = "Missing guild id";
        return;
      }

      const cacheKey = `guild:${guildId}`;
      let feed = getCachedIcs(cacheKey);
      if (!feed) {
        const built = await buildGuildDiscordEventCalendar(guildId);
        if (!built) {
          ctx.status = 404;
          ctx.body = "Guild not found";
          return;
        }
        setCachedIcs(cacheKey, built);
        feed = built;
      }

      sendIcs(ctx, feed, "shield-events.ics");
    } catch (error: unknown) {
      loggers.bot.error("Failed to serve event calendar ICS", error);
      ctx.status = 500;
      ctx.body = "Failed to build calendar";
    }
  }

  @Get("/api/events/:guildId/host/:userId/calendar.ics")
  async getHostCalendarIcs(ctx: Context) {
    try {
      const guildId = ctx.params.guildId;
      const userId = ctx.params.userId;
      if (
        !guildId ||
        typeof guildId !== "string" ||
        !userId ||
        typeof userId !== "string"
      ) {
        ctx.status = 400;
        ctx.body = "Missing guild id or user id";
        return;
      }

      if (!/^\d{17,20}$/.test(userId)) {
        ctx.status = 400;
        ctx.body = "Invalid user id";
        return;
      }

      const cacheKey = `host:${guildId}:${userId}`;
      let feed = getCachedIcs(cacheKey);
      if (!feed) {
        const built = await buildHostPlannedEventCalendar(guildId, userId);
        if (!built) {
          ctx.status = 404;
          ctx.body = "Guild not found";
          return;
        }
        setCachedIcs(cacheKey, built);
        feed = built;
      }

      sendIcs(ctx, feed, "shield-host-events.ics");
    } catch (error: unknown) {
      loggers.bot.error("Failed to serve host event calendar ICS", error);
      ctx.status = 500;
      ctx.body = "Failed to build calendar";
    }
  }
}
