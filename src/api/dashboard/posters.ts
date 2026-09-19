import { Get, Patch, Post, Router } from "@discordx/koa";
import type { Context } from "koa";
import {
  PosterFrameError,
  PosterValidationError,
  posterManager,
} from "../../managers/posters/posterManager.js";
import { POSTERS_MAX_SLOTS } from "../../managers/posters/posterManifest.js";
import {
  bearerToken,
  DashboardAuthError,
  DashboardConfigError,
  DashboardForbiddenError,
  resolveDashboardMember,
  setDashboardCors,
} from "../../utility/dashboard/auth.js";
import {
  buildDashboardSession,
  requireStaff,
  type DashboardSession,
} from "../../utility/dashboard/session.js";
import { logDashboardSessionAction } from "../../utility/dashboard/activityLog.js";
import { loggers } from "../../utility/logger.js";

function jsonError(ctx: Context, status: number, error: string): void {
  ctx.status = status;
  ctx.body = { error };
}

async function withDashboardAuth(
  ctx: Context,
  handler: (session: DashboardSession) => Promise<void>,
): Promise<void> {
  setDashboardCors(ctx);
  if (ctx.method === "OPTIONS") {
    ctx.status = 204;
    return;
  }

  const token = bearerToken(ctx);
  if (!token) {
    jsonError(ctx, 401, "Missing authorization token.");
    return;
  }

  try {
    const { user, member } = await resolveDashboardMember(token);
    const session = await buildDashboardSession(user, member);
    await handler(session);
  } catch (error) {
    if (error instanceof DashboardAuthError) {
      jsonError(ctx, 401, error.message);
      return;
    }
    if (error instanceof DashboardConfigError) {
      jsonError(ctx, 503, error.message);
      return;
    }
    if (error instanceof DashboardForbiddenError) {
      jsonError(ctx, 403, error.message);
      return;
    }
    if (
      error instanceof PosterValidationError ||
      error instanceof PosterFrameError
    ) {
      jsonError(ctx, 400, error.message);
      return;
    }
    loggers.bot.error("Dashboard posters API error", error);
    jsonError(ctx, 500, "Internal server error.");
  }
}

function parseSlot(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const slot = Number(raw);
  if (!Number.isInteger(slot) || slot < 0 || slot >= POSTERS_MAX_SLOTS) {
    return null;
  }
  return slot;
}

type MulterFile = {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
  size?: number;
};

function getUploadedFile(ctx: Context): MulterFile | undefined {
  const fromCtx = (ctx as Context & { file?: MulterFile }).file;
  if (fromCtx?.buffer) {
    return fromCtx;
  }
  const fromReq = (
    ctx.request as Context["request"] & { file?: MulterFile }
  ).file;
  return fromReq?.buffer ? fromReq : undefined;
}

@Router()
export class DashboardPostersAPI {
  @Get("/api/dashboard/admin/posters")
  async listPosters(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireStaff(session);
      const list = await posterManager.listForStaff(session.guildId);
      ctx.body = list;
    });
  }

  @Post("/api/dashboard/admin/posters/:slot")
  async uploadPoster(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireStaff(session);

      const slot = parseSlot(ctx.params.slot);
      if (slot === null) {
        jsonError(
          ctx,
          400,
          `Slot must be an integer from 0 to ${POSTERS_MAX_SLOTS - 1}.`,
        );
        return;
      }

      const file = getUploadedFile(ctx);
      if (!file) {
        jsonError(ctx, 400, "Missing image file (multipart field name: file).");
        return;
      }

      const body = ctx.request.body as
        | { title?: string; id?: string }
        | undefined;
      const title = typeof body?.title === "string" ? body.title : "";
      const id = typeof body?.id === "string" ? body.id : null;

      const result = await posterManager.setPoster({
        guildId: session.guildId,
        slot,
        title,
        id,
        image: file.buffer,
        mimeType: file.mimetype,
        updatedBy: session.user.id,
      });

      logDashboardSessionAction(
        session,
        "Poster uploaded",
        `Updated community board poster slot **${slot}** via the Activity dashboard.`,
        [
          { name: "Slot", value: String(slot), inline: true },
          {
            name: "Version",
            value: String(result.manifest.version),
            inline: true,
          },
          { name: "Image", value: result.imageUrl },
        ],
        "mod",
      );

      const entry = result.manifest.posters.find((p) => p.slot === slot);
      ctx.body = {
        version: result.manifest.version,
        updatedAt: result.manifest.updatedAt,
        poster: {
          slot,
          id: entry?.id ?? "",
          title: entry?.title ?? title,
          enabled: entry?.enabled ?? true,
          imageUrl: result.imageUrl,
        },
        commitSha: result.commitSha ?? null,
      };
    });
  }

  @Patch("/api/dashboard/admin/posters/:slot")
  async patchPoster(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireStaff(session);

      const slot = parseSlot(ctx.params.slot);
      if (slot === null) {
        jsonError(
          ctx,
          400,
          `Slot must be an integer from 0 to ${POSTERS_MAX_SLOTS - 1}.`,
        );
        return;
      }

      const body = ctx.request.body as
        | { enabled?: boolean; title?: string; id?: string }
        | undefined;

      if (
        body?.enabled === undefined &&
        body?.title === undefined &&
        body?.id === undefined
      ) {
        jsonError(ctx, 400, "Provide enabled, title, and/or id.");
        return;
      }

      const result = await posterManager.updatePosterMeta({
        guildId: session.guildId,
        slot,
        enabled: body?.enabled,
        title: body?.title,
        id: body?.id,
        updatedBy: session.user.id,
      });

      logDashboardSessionAction(
        session,
        "Poster metadata updated",
        `Updated community board poster slot **${slot}** via the Activity dashboard.`,
        [
          { name: "Slot", value: String(slot), inline: true },
          {
            name: "Version",
            value: String(result.manifest.version),
            inline: true,
          },
          {
            name: "Enabled",
            value: String(
              result.manifest.posters.find((p) => p.slot === slot)?.enabled ??
                false,
            ),
            inline: true,
          },
        ],
        "mod",
      );

      const entry = result.manifest.posters.find((p) => p.slot === slot);
      ctx.body = {
        version: result.manifest.version,
        updatedAt: result.manifest.updatedAt,
        poster: {
          slot,
          id: entry?.id ?? "",
          title: entry?.title ?? "",
          enabled: entry?.enabled ?? false,
          imageUrl: result.imageUrl,
        },
        commitSha: result.commitSha ?? null,
      };
    });
  }
}
