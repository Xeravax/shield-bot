import { Get, Router } from "@discordx/koa";
import { Context } from "koa";
import { whitelistManager } from "../../../managers/whitelist/whitelistManager.js";
import crypto from "crypto";

@Router()
export class WhitelistAPI {
  // Get encoded whitelist (for VRChat clients) - guild-specific
  @Get("/api/vrchat/:guildId/whitelist/encoded")
  async getEncodedWhitelist(ctx: Context) {
    try {
      const guildId = ctx.params.guildId;
      const encodedWhitelist = await whitelistManager.generateEncodedWhitelist(guildId);
      const etag = crypto.createHash("sha256").update(encodedWhitelist).digest("hex");
      const lastUpdate = whitelistManager.getLastUpdateTimestamp(guildId);
      const lastModified = lastUpdate ? new Date(lastUpdate).toUTCString() : undefined;

      if (
        ctx.headers["if-none-match"] === etag ||
        (lastModified && ctx.headers["if-modified-since"] === lastModified)
      ) {
        ctx.status = 304;
        return;
      }
      ctx.set("Cache-Control", "public, max-age=86400");
      ctx.set("ETag", etag);
      if (lastModified) {ctx.set("Last-Modified", lastModified);}
      ctx.body = {
        success: true,
        data: encodedWhitelist,
      };
    } catch (error: unknown) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  // Get encoded v2 (JSON) whitelist - guild-specific. Same envelope as /encoded; the body is
  // {"v":2,"generatedAt":<unix seconds>,"users":{"Name":["perm",...]}}.
  @Get("/api/vrchat/:guildId/whitelist/v2/encoded")
  async getEncodedWhitelistV2(ctx: Context) {
    try {
      const guildId = ctx.params.guildId;
      const { encoded, contentHash } = await whitelistManager.generateEncodedWhitelistV2(guildId);
      const lastUpdate = whitelistManager.getLastUpdateTimestamp(guildId);
      const lastModified = lastUpdate ? new Date(lastUpdate).toUTCString() : undefined;
      if (
        ctx.headers["if-none-match"] === contentHash ||
        (lastModified && ctx.headers["if-modified-since"] === lastModified)
      ) {
        ctx.status = 304;
        return;
      }
      ctx.set("Cache-Control", "public, max-age=86400");
      ctx.set("ETag", contentHash);
      if (lastModified) {ctx.set("Last-Modified", lastModified);}
      ctx.body = {
        success: true,
        data: encoded,
      };
    } catch (error: unknown) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  // Get raw v2 (plain JSON) whitelist - guild-specific. Same envelope as /raw; data is the
  // unencoded {"v":2,"generatedAt":...,"users":{...}} document that /v2/encoded wraps.
  @Get("/api/vrchat/:guildId/whitelist/v2/raw")
  async getRawWhitelistV2(ctx: Context) {
    try {
      const guildId = ctx.params.guildId;
      const { content, contentHash } = await whitelistManager.generateWhitelistContentV2(guildId);
      const lastUpdate = whitelistManager.getLastUpdateTimestamp(guildId);
      const lastModified = lastUpdate ? new Date(lastUpdate).toUTCString() : undefined;
      if (
        ctx.headers["if-none-match"] === contentHash ||
        (lastModified && ctx.headers["if-modified-since"] === lastModified)
      ) {
        ctx.status = 304;
        return;
      }
      ctx.set("Cache-Control", "public, max-age=86400");
      ctx.set("ETag", contentHash);
      if (lastModified) {ctx.set("Last-Modified", lastModified);}
      ctx.body = {
        success: true,
        data: content,
      };
    } catch (error: unknown) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  // Get whitelist statistics (v2 marker) - same data as /stats
  @Get("/api/vrchat/:guildId/whitelist/v2/stats")
  async getStatisticsV2(ctx: Context) {
    return this.getStatistics(ctx);
  }

  // Get raw whitelist content - guild-specific
  @Get("/api/vrchat/:guildId/whitelist/raw")
  async getRawWhitelist(ctx: Context) {
    try {
      const guildId = ctx.params.guildId;
      const content = await whitelistManager.generateWhitelistContent(guildId);
      const etag = crypto.createHash("sha256").update(content).digest("hex");
      const lastUpdate = whitelistManager.getLastUpdateTimestamp(guildId);
      const lastModified = lastUpdate ? new Date(lastUpdate).toUTCString() : undefined;

      if (
        ctx.headers["if-none-match"] === etag ||
        (lastModified && ctx.headers["if-modified-since"] === lastModified)
      ) {
        ctx.status = 304;
        return;
      }
      ctx.set("Cache-Control", "public, max-age=86400");
      ctx.set("ETag", etag);
      if (lastModified) {ctx.set("Last-Modified", lastModified);}
      ctx.body = {
        success: true,
        data: content,
      };
    } catch (error: unknown) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  // Get whitelist statistics - guild-specific
  @Get("/api/vrchat/:guildId/whitelist/stats")
  async getStatistics(ctx: Context) {
    try {
      const guildId = ctx.params.guildId;
      const stats = await whitelistManager.getStatistics(guildId);

      ctx.body = {
        success: true,
        data: {
          ...stats,
          guildId,
        },
      };
    } catch (error: unknown) {
      ctx.status = 500;
      ctx.body = {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }
}
