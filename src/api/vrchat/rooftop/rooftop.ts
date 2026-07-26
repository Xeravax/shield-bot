import { Get, Router } from "@discordx/koa";
import { Context } from "koa";
import { GitHubPublisher } from "../../../managers/whitelist/githubPublisher.js";
import crypto from "crypto";

const githubPublisher = new GitHubPublisher();

@Router()
export class RooftopAPI {
  @Get("/api/vrchat/:guildId/rooftop/permissions")
  async getCombinedPermissions(ctx: Context) {
    try {
      const guildId = ctx.params.guildId;
      const files = await githubPublisher.generateRooftopFiles(guildId);
      const content = files.permissionsJson;
      const etag = crypto.createHash("sha256").update(content).digest("hex");

      if (ctx.headers["if-none-match"] === etag) {
        ctx.status = 304;
        return;
      }

      ctx.set("Cache-Control", "public, max-age=86400");
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
