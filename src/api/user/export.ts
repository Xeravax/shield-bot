import { Get, Router } from "@discordx/koa";
import type { Context } from "koa";
import { readFileSync } from "node:fs";
import { getUserExportData } from "../../utility/userDataExport.js";
import { verifyUserExportToken } from "../../utility/userExportToken.js";
import { loggers } from "../../utility/logger.js";

function queryToken(ctx: Context): string | null {
  const raw = ctx.query.t;
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0].length > 0) {
    return raw[0];
  }
  return null;
}

@Router()
export class UserExportAPI {
  @Get("/export")
  async page(ctx: Context): Promise<void> {
    const file = readFileSync("public/export.html", "utf-8");
    ctx.set("Content-Type", "text/html; charset=utf-8");
    ctx.set("X-Robots-Tag", "noindex, nofollow");
    ctx.set("Referrer-Policy", "no-referrer");
    ctx.body = file;
  }

  @Get("/api/user/export")
  async data(ctx: Context): Promise<void> {
    ctx.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
    ctx.set("Pragma", "no-cache");
    ctx.set("X-Robots-Tag", "noindex, nofollow");

    const token = queryToken(ctx);
    if (!token) {
      ctx.status = 401;
      ctx.body = { error: "Missing view token" };
      return;
    }

    const verified = verifyUserExportToken(token);
    if (!verified) {
      ctx.status = 401;
      ctx.body = { error: "Invalid or expired link" };
      return;
    }

    try {
      const payload = await getUserExportData(verified.discordId);
      if (!payload) {
        ctx.status = 404;
        ctx.body = { error: "No data stored" };
        return;
      }
      ctx.body = payload;
    } catch (error: unknown) {
      loggers.bot.error("Failed to serve user export view", error, {
        discordId: verified.discordId,
      });
      ctx.status = 500;
      ctx.body = { error: "Failed to load export" };
    }
  }
}
