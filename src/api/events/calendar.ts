import { Get, Router } from "@discordx/koa";
import type { Context } from "koa";
import {
  buildGuildDiscordEventCalendar,
  buildHostPlannedEventCalendar,
} from "../../managers/events/discordEventCalendarFeed.js";
import { loggers } from "../../utility/logger.js";

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

      const feed = await buildGuildDiscordEventCalendar(guildId);
      if (!feed) {
        ctx.status = 404;
        ctx.body = "Guild not found";
        return;
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

      const feed = await buildHostPlannedEventCalendar(guildId, userId);
      if (!feed) {
        ctx.status = 404;
        ctx.body = "Guild not found";
        return;
      }

      sendIcs(ctx, feed, "shield-host-events.ics");
    } catch (error: unknown) {
      loggers.bot.error("Failed to serve host event calendar ICS", error);
      ctx.status = 500;
      ctx.body = "Failed to build calendar";
    }
  }
}
