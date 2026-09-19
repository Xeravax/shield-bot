import { Get, Router } from "@discordx/koa";
import { Context } from "koa";
import crypto from "crypto";
import { posterManager } from "../../../managers/posters/posterManager.js";

@Router()
export class PostersAPI {
  @Get("/api/vrchat/:guildId/posters.json")
  async getPostersJson(ctx: Context) {
    try {
      const guildId = ctx.params.guildId;
      if (!guildId || !/^\d{17,20}$/.test(guildId)) {
        ctx.status = 400;
        ctx.body = { success: false, error: "Invalid guild id" };
        return;
      }

      const content = await posterManager.getManifestJson(guildId);
      const etag = crypto.createHash("sha256").update(content).digest("hex");

      if (ctx.headers["if-none-match"] === etag) {
        ctx.status = 304;
        return;
      }

      ctx.set("Cache-Control", "public, max-age=60");
      ctx.set("Content-Type", "application/json; charset=utf-8");
      ctx.set("ETag", etag);
      ctx.body = content;
    } catch (error: unknown) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }
}
