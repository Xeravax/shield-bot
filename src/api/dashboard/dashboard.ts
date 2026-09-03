import { Delete, Get, Post, Put, Router } from "@discordx/koa";
import type { Context } from "koa";
import { EventDuty, EventType, PlannedEventStatus } from "../../generated/prisma/client.js";
import { bot, modCaseManager, patrolTimer, prisma } from "../../main.js";
import { getCurrentEventWeekRange } from "../../managers/events/eventWeek.js";
import {
  normalizeEventTitle,
  resolveDraftStartTime,
} from "../../managers/events/eventDraftDefaults.js";
import {
  defaultDurationMinutes,
  isDurationAllowedForDuty,
  parseEventTypeOption,
} from "../../managers/events/eventType.js";
import {
  approvePlannedEvent,
  beginEventEditForHost,
  canEditEventPanel,
  canManageEventDraft,
  canUserCancelPlannedEvent,
  cancelPlannedEvent,
  denyPlannedEvent,
  runEventValidation,
  submitEventForApproval,
  updatePlanningChannelMessage,
} from "../../managers/events/eventPlanningManager.js";
import { getGuildCalendarFeedUrl } from "../../managers/events/discordEventCalendarFeed.js";
import { hasNode } from "../../utility/permissionNodes.js";
import {
  bearerToken,
  dashboardGuildId,
  DashboardAuthError,
  DashboardConfigError,
  DashboardForbiddenError,
  exchangeOAuthCode,
  fetchDiscordUser,
  resolveDashboardMember,
  setDashboardCors,
} from "../../utility/dashboard/auth.js";
import {
  buildDashboardSession,
  requireHost,
  requireShieldMember,
  requireStaff,
  type DashboardSession,
} from "../../utility/dashboard/session.js";
import {
  logDashboardAction,
  logDashboardSessionAction,
} from "../../utility/dashboard/activityLog.js";
import {
  resolveTimezoneInput,
  updateUserPreferences,
} from "../../utility/userPreferences.js";
import { loggers } from "../../utility/logger.js";

function jsonError(
  ctx: Context,
  status: number,
  error: string,
): void {
  ctx.status = status;
  ctx.body = { error };
}

async function withDashboardAuth<T>(
  ctx: Context,
  handler: (session: Awaited<ReturnType<typeof buildDashboardSession>>) => Promise<T>,
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
    loggers.bot.error("Dashboard API error", error);
    jsonError(ctx, 500, "Internal server error.");
  }
}

function msToHours(ms: number | bigint): number {
  return Math.round((Number(ms) / 3_600_000) * 100) / 100;
}

function memberLabel(guildId: string, userId: string): string {
  const guild = bot.guilds.cache.get(guildId);
  const member = guild?.members.cache.get(userId);
  return member?.displayName ?? member?.user.username ?? userId;
}

async function resolveGuild(guildId: string) {
  return (
    bot.guilds.cache.get(guildId) ??
    (await bot.guilds.fetch(guildId).catch(() => null))
  );
}

function serializePlannedEvent(
  e: {
    id: number;
    title: string;
    startTime: Date;
    hostId: string;
    coHostId: string | null;
    duty: string;
    eventType: string | null;
    durationMinutes: number;
    status: string;
    denialReason?: string | null;
    discordEventId?: string | null;
  },
  extras?: { canEdit?: boolean; canDelete?: boolean },
) {
  return {
    id: e.id,
    title: e.title,
    startTime: e.startTime.toISOString(),
    endTime: new Date(
      e.startTime.getTime() + e.durationMinutes * 60_000,
    ).toISOString(),
    hostId: e.hostId,
    coHostId: e.coHostId,
    duty: e.duty,
    eventType: e.eventType,
    durationMinutes: e.durationMinutes,
    status: e.discordEventId ? "PUBLISHED" : e.status,
    denialReason: e.denialReason ?? null,
    published: Boolean(e.discordEventId),
    canEdit: extras?.canEdit,
    canDelete: extras?.canDelete,
  };
}

async function handleHostEventDelete(ctx: Context): Promise<void> {
  await withDashboardAuth(ctx, async (session: DashboardSession) => {
    await requireHost(session);

    const eventId = Number(ctx.params.eventId);
    if (!Number.isFinite(eventId)) {
      jsonError(ctx, 400, "Invalid event id.");
      return;
    }

    const existing = await prisma.plannedEvent.findUnique({
      where: { id: eventId },
    });
    if (!existing || existing.guildId !== session.guildId) {
      jsonError(ctx, 404, "Event not found.");
      return;
    }

    const guild =
      bot.guilds.cache.get(session.guildId) ??
      (await bot.guilds.fetch(session.guildId).catch(() => null));
    if (!guild) {
      jsonError(ctx, 503, "Guild unavailable.");
      return;
    }

    const member = session.member;
    let result: { success: boolean; error?: string; message?: string };

    if (
      existing.status === PlannedEventStatus.PENDING ||
      existing.status === PlannedEventStatus.APPROVED
    ) {
      if (!(await canUserCancelPlannedEvent(session.user.id, member, existing))) {
        jsonError(ctx, 403, "You cannot delete this event.");
        return;
      }
      result = await cancelPlannedEvent(eventId, guild, session.user.id);
    } else if (
      existing.status === PlannedEventStatus.DRAFT ||
      existing.status === PlannedEventStatus.DENIED
    ) {
      if (!(await canManageEventDraft(session.user.id, member, existing.hostId))) {
        jsonError(ctx, 403, "You cannot delete this event.");
        return;
      }
      await prisma.plannedEvent.delete({ where: { id: eventId } });
      result = { success: true, message: "Event deleted." };
    } else {
      jsonError(ctx, 400, "This event cannot be deleted.");
      return;
    }

    if (!result.success) {
      jsonError(ctx, 400, result.error ?? "Could not delete event.");
      return;
    }

    logDashboardSessionAction(
      session,
      "Event deleted",
      `Deleted **${existing.title}** (#${existing.id}) from the Activity dashboard.`,
      [{ name: "Status", value: existing.status, inline: true }],
      "mod",
    );

    ctx.body = { ok: true, message: result.message ?? "Event deleted." };
  });
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

@Router()
export class DashboardAPI {
  @Post("/api/dashboard/token")
  async token(ctx: Context): Promise<void> {
    setDashboardCors(ctx);
    if (ctx.method === "OPTIONS") {
      ctx.status = 204;
      return;
    }

    const body = ctx.request.body as { code?: string } | undefined;
    const code = body?.code;
    if (!code || typeof code !== "string") {
      jsonError(ctx, 400, "Missing authorization code.");
      return;
    }

    try {
      const token = await exchangeOAuthCode(code);
      ctx.body = { access_token: token.access_token };

      try {
        const user = await fetchDiscordUser(token.access_token);
        const displayName = user.global_name || user.username;
        logDashboardAction({
          guildId: dashboardGuildId(),
          userId: user.id,
          displayName,
          title: "Dashboard login",
          description: "OAuth session established via Discord Activity.",
          severity: "success",
        });
      } catch (logError) {
        loggers.bot.debug("Dashboard login log skipped", {
          error: logError instanceof Error ? logError.message : String(logError),
        });
      }
    } catch (error) {
      if (error instanceof DashboardConfigError) {
        jsonError(ctx, 503, error.message);
        return;
      }
      if (error instanceof DashboardAuthError) {
        jsonError(ctx, 401, error.message);
        return;
      }
      loggers.bot.error("Dashboard token exchange failed", error);
      jsonError(ctx, 500, "Token exchange failed.");
    }
  }

  @Get("/api/dashboard/me")
  async me(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      ctx.body = {
        id: session.user.id,
        username: session.user.username,
        globalName: session.user.global_name,
        displayName: session.displayName,
        avatarUrl: session.avatarUrl,
        timezone: session.timezone,
        timezoneStored: session.timezoneStored,
        guildId: session.guildId,
        shieldMember: session.shieldMember,
        deputy: session.deputy,
        staff: session.staff,
        host: session.host,
        hostLead: session.hostLead,
        canForceSchedule: session.canForceSchedule,
        trainerTypes: session.trainerTypes,
      };
    });
  }

  @Get("/api/dashboard/hours")
  async hours(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireShieldMember(session);

      const monthsRaw = ctx.query.months;
      const months = Math.min(
        12,
        Math.max(1, parseInt(String(monthsRaw ?? "6"), 10) || 6),
      );

      const now = new Date();
      const results: Array<{
        year: number;
        month: number;
        label: string;
        hours: number;
        isCurrent: boolean;
      }> = [];

      for (let i = 0; i < months; i++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const year = d.getUTCFullYear();
        const month = d.getUTCMonth() + 1;
        const totalMs = await patrolTimer.getUserTotalForMonth(
          session.guildId,
          session.user.id,
          year,
          month,
        );
        results.push({
          year,
          month,
          label: `${MONTH_NAMES[month - 1]} ${year}`,
          hours: msToHours(totalMs),
          isCurrent: i === 0,
        });
      }

      ctx.body = { months: results.reverse() };
    });
  }

  @Get("/api/dashboard/events")
  async events(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireShieldMember(session);

      const fromRaw = ctx.query.from;
      const toRaw = ctx.query.to;
      const from = fromRaw ? new Date(String(fromRaw)) : new Date(Date.now() - 90 * 86_400_000);
      const to = toRaw ? new Date(String(toRaw)) : new Date(Date.now() + 90 * 86_400_000);

      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        jsonError(ctx, 400, "Invalid from/to date.");
        return;
      }

      const includePlanning =
        session.host && String(ctx.query.planning ?? "") === "1";

      // Published Discord events; hosts may also request unpublished planning rows.
      const rows = await prisma.plannedEvent.findMany({
        where: {
          guildId: session.guildId,
          startTime: { gte: from, lte: to },
          ...(includePlanning
            ? {}
            : { discordEventId: { not: null } }),
        },
        orderBy: { startTime: "asc" },
        select: {
          id: true,
          title: true,
          startTime: true,
          hostId: true,
          coHostId: true,
          duty: true,
          eventType: true,
          durationMinutes: true,
          status: true,
          denialReason: true,
          discordEventId: true,
        },
      });

      const icsUrl = getGuildCalendarFeedUrl(session.guildId);
      const webcalUrl = icsUrl.replace(/^https:/i, "webcal:");

      ctx.body = {
        calendar: {
          icsUrl,
          webcalUrl,
          googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(icsUrl)}`,
          appleUrl: webcalUrl,
        },
        events: rows.map((e) =>
          serializePlannedEvent(e, {
            canEdit:
              includePlanning &&
              (session.hostLead || e.hostId === session.user.id),
            canDelete:
              includePlanning &&
              (session.hostLead || e.hostId === session.user.id),
          }),
        ),
      };
    });
  }

  @Put("/api/dashboard/me/timezone")
  async setTimezone(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      const body = ctx.request.body as { timezone?: string } | undefined;
      const input = body?.timezone?.trim();
      if (!input) {
        jsonError(ctx, 400, "Missing timezone.");
        return;
      }

      const resolved = resolveTimezoneInput(input);
      if (!resolved) {
        jsonError(ctx, 400, "Invalid timezone.");
        return;
      }

      const prefs = await updateUserPreferences(session.user.id, {
        timezone: resolved,
      });

      logDashboardSessionAction(
        session,
        "Timezone updated",
        `Set timezone to \`${resolved}\`.`,
        [{ name: "Timezone", value: `\`${resolved}\``, inline: true }],
      );

      ctx.body = {
        timezone: prefs.timezone,
        timezoneStored: prefs.timezoneStored,
      };
    });
  }

  @Post("/api/dashboard/host/events/validate")
  async validateHostEvent(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireHost(session);

      const parsed = parseHostEventBody(ctx);
      if (!parsed.ok) {
        jsonError(ctx, 400, parsed.error);
        return;
      }

      const { data } = parsed;
      const force = data.force && session.canForceSchedule;
      const timezone = session.timezone;
      const startTime = resolveDraftStartTime(data.time, timezone, {
        enforceWeek: !force,
      });

      const guild = bot.guilds.cache.get(session.guildId) ?? null;
      const { results, overriddenIds } = await runEventValidation(
        {
          id: 0,
          guildId: session.guildId,
          title: data.title,
          startTime,
          hostId: session.user.id,
          coHostId: data.coHostId ?? null,
          coHostOpen: false,
          duty: data.duty,
          eventType: data.eventType ?? null,
          durationMinutes: data.durationMinutes,
          status: PlannedEventStatus.DRAFT,
          denialReason: null,
          reviewedById: null,
          planningMessageId: null,
          pendingCoHostUserId: null,
          coHostRequestMessageId: null,
          discordEventId: null,
          forceOverride: force,
          editResumeStatus: null,
          editSnapshot: null,
          editStartedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        guild,
        force,
      );

      ctx.body = {
        startTime: startTime.toISOString(),
        results,
        overriddenIds,
        blocking: results.some(
          (r) => r.severity === "fail" && !overriddenIds.includes(r.id),
        ),
      };
    });
  }

  @Get("/api/dashboard/host/events")
  async listHostEvents(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireHost(session);

      const rows = await prisma.plannedEvent.findMany({
        where: {
          guildId: session.guildId,
          ...(session.hostLead ? {} : { hostId: session.user.id }),
          OR: [
            {
              status: {
                in: [
                  PlannedEventStatus.DRAFT,
                  PlannedEventStatus.PENDING,
                  PlannedEventStatus.DENIED,
                ],
              },
            },
            {
              status: PlannedEventStatus.APPROVED,
              discordEventId: null,
            },
          ],
        },
        orderBy: { startTime: "asc" },
        take: 100,
        select: {
          id: true,
          title: true,
          startTime: true,
          hostId: true,
          coHostId: true,
          duty: true,
          eventType: true,
          durationMinutes: true,
          status: true,
          denialReason: true,
          discordEventId: true,
        },
      });

      ctx.body = {
        hostLead: session.hostLead,
        canForceSchedule: session.canForceSchedule,
        events: rows.map((e) => {
          const own = session.hostLead || e.hostId === session.user.id;
          return serializePlannedEvent(e, { canEdit: own, canDelete: own });
        }),
      };
    });
  }

  @Post("/api/dashboard/host/events")
  async createHostEvent(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireHost(session);

      if (!session.timezoneStored) {
        jsonError(ctx, 403, "Timezone must be configured before scheduling.");
        return;
      }

      const parsed = parseHostEventBody(ctx);
      if (!parsed.ok) {
        jsonError(ctx, 400, parsed.error);
        return;
      }

      const { data } = parsed;
      const force = data.force && session.canForceSchedule;
      const startTime = resolveDraftStartTime(data.time, session.timezone, {
        enforceWeek: !force,
      });

      const event = await prisma.plannedEvent.create({
        data: {
          guildId: session.guildId,
          title: normalizeEventTitle(data.title),
          startTime,
          hostId: session.user.id,
          coHostId: data.coHostId ?? null,
          coHostOpen: false,
          duty: data.duty,
          eventType: data.eventType ?? null,
          durationMinutes: data.durationMinutes,
          forceOverride: force,
        },
      });

      const guild = bot.guilds.cache.get(session.guildId) ?? null;
      const validation = await runEventValidation(event, guild, force);

      logDashboardSessionAction(
        session,
        "Event draft created",
        `Created draft **${event.title}** from the Activity dashboard.`,
        [
          { name: "Event ID", value: `\`${event.id}\``, inline: true },
          {
            name: "Start",
            value: `<t:${Math.floor(event.startTime.getTime() / 1000)}:F>`,
            inline: true,
          },
          { name: "Duty", value: data.duty, inline: true },
          {
            name: "Duration",
            value: `${data.durationMinutes} min`,
            inline: true,
          },
        ],
        "success",
      );

      ctx.body = {
        eventId: event.id,
        startTime: event.startTime.toISOString(),
        validation,
      };
    });
  }

  @Put("/api/dashboard/host/events/:eventId")
  async updateHostEvent(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireHost(session);

      if (!session.timezoneStored) {
        jsonError(ctx, 403, "Timezone must be configured before editing.");
        return;
      }

      const eventId = Number(ctx.params.eventId);
      if (!Number.isFinite(eventId)) {
        jsonError(ctx, 400, "Invalid event id.");
        return;
      }

      const existing = await prisma.plannedEvent.findUnique({
        where: { id: eventId },
      });
      if (!existing || existing.guildId !== session.guildId) {
        jsonError(ctx, 404, "Event not found.");
        return;
      }

      if (
        !(await canEditEventPanel(
          session.user.id,
          session.member,
          existing.hostId,
        ))
      ) {
        jsonError(ctx, 403, "You cannot edit this event.");
        return;
      }

      const parsed = parseHostEventBody(ctx);
      if (!parsed.ok) {
        jsonError(ctx, 400, parsed.error);
        return;
      }

      const guild =
        bot.guilds.cache.get(session.guildId) ??
        (await bot.guilds.fetch(session.guildId).catch(() => null));
      if (!guild) {
        jsonError(ctx, 503, "Guild unavailable.");
        return;
      }

      const opened = await beginEventEditForHost(
        eventId,
        guild,
        session.user.id,
        session.member,
      );
      if (!opened.success) {
        jsonError(ctx, 400, opened.error ?? "Cannot edit this event.");
        return;
      }

      const { data } = parsed;
      const force = data.force && session.canForceSchedule;
      const startTime = resolveDraftStartTime(data.time, session.timezone, {
        enforceWeek: !force,
      });

      const updated = await prisma.plannedEvent.update({
        where: { id: eventId },
        data: {
          title: normalizeEventTitle(data.title),
          startTime,
          duty: data.duty,
          eventType: data.eventType ?? null,
          durationMinutes: data.durationMinutes,
          forceOverride: force,
        },
      });

      await updatePlanningChannelMessage(guild, updated);
      const validation = await runEventValidation(updated, guild, force);

      logDashboardSessionAction(
        session,
        "Event draft updated",
        `Updated **${updated.title}** (#${updated.id}) from the Activity dashboard.`,
        [
          {
            name: "Start",
            value: `<t:${Math.floor(updated.startTime.getTime() / 1000)}:F>`,
            inline: true,
          },
          { name: "Status", value: updated.status, inline: true },
        ],
      );

      ctx.body = {
        eventId: updated.id,
        startTime: updated.startTime.toISOString(),
        status: updated.status,
        validation,
      };
    });
  }

  @Delete("/api/dashboard/host/events/:eventId")
  async deleteHostEvent(ctx: Context): Promise<void> {
    await handleHostEventDelete(ctx);
  }

  @Post("/api/dashboard/host/events/:eventId/delete")
  async deleteHostEventAlias(ctx: Context): Promise<void> {
    await handleHostEventDelete(ctx);
  }

  @Post("/api/dashboard/host/events/:eventId/submit")
  async submitHostEvent(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireHost(session);

      const eventId = Number(ctx.params.eventId);
      if (!Number.isFinite(eventId)) {
        jsonError(ctx, 400, "Invalid event id.");
        return;
      }

      const existing = await prisma.plannedEvent.findUnique({
        where: { id: eventId },
      });
      if (!existing || existing.guildId !== session.guildId) {
        jsonError(ctx, 404, "Event not found.");
        return;
      }

      if (
        !(await canManageEventDraft(
          session.user.id,
          session.member,
          existing.hostId,
        ))
      ) {
        jsonError(ctx, 403, "You cannot submit this event.");
        return;
      }

      const guild = await resolveGuild(session.guildId);
      if (!guild) {
        jsonError(ctx, 503, "Guild unavailable.");
        return;
      }

      const result = await submitEventForApproval(eventId, guild);
      if (!result.success || !result.event) {
        jsonError(ctx, 400, result.error ?? "Could not submit event.");
        return;
      }

      logDashboardSessionAction(
        session,
        "Event submitted",
        `Submitted **${result.event.title}** (#${result.event.id}) for planning review.`,
        [
          { name: "Status", value: result.event.status, inline: true },
          {
            name: "Start",
            value: `<t:${Math.floor(result.event.startTime.getTime() / 1000)}:F>`,
            inline: true,
          },
        ],
        "success",
      );

      ctx.body = {
        ok: true,
        message: "Event submitted to the planning channel.",
        event: serializePlannedEvent(result.event, {
          canEdit: true,
          canDelete: true,
        }),
      };
    });
  }

  @Post("/api/dashboard/host/events/:eventId/approve")
  async approveHostEvent(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireHost(session);
      if (!session.hostLead) {
        jsonError(ctx, 403, "Only event leads can approve events.");
        return;
      }

      const eventId = Number(ctx.params.eventId);
      if (!Number.isFinite(eventId)) {
        jsonError(ctx, 400, "Invalid event id.");
        return;
      }

      const existing = await prisma.plannedEvent.findUnique({
        where: { id: eventId },
      });
      if (!existing || existing.guildId !== session.guildId) {
        jsonError(ctx, 404, "Event not found.");
        return;
      }

      const guild = await resolveGuild(session.guildId);
      if (!guild) {
        jsonError(ctx, 503, "Guild unavailable.");
        return;
      }

      const result = await approvePlannedEvent(
        eventId,
        session.user.id,
        guild,
      );
      if (!result.success) {
        jsonError(ctx, 400, result.error ?? "Could not approve event.");
        return;
      }

      const updated = await prisma.plannedEvent.findUnique({
        where: { id: eventId },
      });

      logDashboardSessionAction(
        session,
        "Event approved",
        `Approved **${existing.title}** (#${existing.id}) from the Activity dashboard.`,
        [{ name: "Status", value: "APPROVED", inline: true }],
        "success",
      );

      ctx.body = {
        ok: true,
        message: "Event approved.",
        event: updated
          ? serializePlannedEvent(updated, {
              canEdit: true,
              canDelete: true,
            })
          : null,
      };
    });
  }

  @Post("/api/dashboard/host/events/:eventId/deny")
  async denyHostEvent(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireHost(session);
      if (!session.hostLead) {
        jsonError(ctx, 403, "Only event leads can deny events.");
        return;
      }

      const eventId = Number(ctx.params.eventId);
      if (!Number.isFinite(eventId)) {
        jsonError(ctx, 400, "Invalid event id.");
        return;
      }

      const body = ctx.request.body as { reason?: string } | undefined;
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (!reason) {
        jsonError(ctx, 400, "A denial reason is required.");
        return;
      }
      if (reason.length > 1000) {
        jsonError(ctx, 400, "Denial reason is too long.");
        return;
      }

      const existing = await prisma.plannedEvent.findUnique({
        where: { id: eventId },
      });
      if (!existing || existing.guildId !== session.guildId) {
        jsonError(ctx, 404, "Event not found.");
        return;
      }

      const guild = await resolveGuild(session.guildId);
      if (!guild) {
        jsonError(ctx, 503, "Guild unavailable.");
        return;
      }

      const result = await denyPlannedEvent(
        eventId,
        session.user.id,
        reason,
        guild,
      );
      if (!result.success) {
        jsonError(ctx, 400, result.error ?? "Could not deny event.");
        return;
      }

      const updated = await prisma.plannedEvent.findUnique({
        where: { id: eventId },
      });

      logDashboardSessionAction(
        session,
        "Event denied",
        `Denied **${existing.title}** (#${existing.id}) from the Activity dashboard.`,
        [
          { name: "Status", value: "DENIED", inline: true },
          { name: "Reason", value: reason.slice(0, 200) },
        ],
        "mod",
      );

      ctx.body = {
        ok: true,
        message: "Event denied.",
        event: updated
          ? serializePlannedEvent(updated, {
              canEdit: true,
              canDelete: true,
            })
          : null,
      };
    });
  }

  @Get("/api/dashboard/admin/overview")
  async adminOverview(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireStaff(session);

      const week = getCurrentEventWeekRange();
      const now = new Date();
      const year = now.getUTCFullYear();
      const month = now.getUTCMonth() + 1;

      const [pendingEvents, draftEvents, openLoas, recentCases, activeSessions, hoursTop] =
        await Promise.all([
          prisma.plannedEvent.count({
            where: {
              guildId: session.guildId,
              status: PlannedEventStatus.PENDING,
              startTime: { gte: week.start, lt: week.end },
            },
          }),
          prisma.plannedEvent.count({
            where: {
              guildId: session.guildId,
              status: PlannedEventStatus.DRAFT,
            },
          }),
          prisma.leaveOfAbsence.count({
            where: {
              guildId: session.guildId,
              status: { in: ["APPROVED", "ACTIVE"] },
            },
          }),
          prisma.modCase.findMany({
            where: { guildId: session.guildId },
            orderBy: { createdAt: "desc" },
            take: 40,
            select: {
              id: true,
              caseNumber: true,
              type: true,
              targetId: true,
              moderatorId: true,
              reason: true,
              createdAt: true,
              logMessageId: true,
              logThreadId: true,
            },
          }),
          prisma.activeVoicePatrolSession.findMany({
            where: { guildId: session.guildId },
            select: { userId: true, startedAt: true, channelId: true },
            orderBy: { startedAt: "asc" },
          }),
          patrolTimer.getTopByMonth(session.guildId, year, month, 1000),
        ]);

      const hoursMembers = hoursTop.slice(0, 25).map((row) => ({
        userId: row.userId,
        displayName: memberLabel(session.guildId, row.userId),
        hours: msToHours(row.totalMs),
      }));
      const monthHoursTotal = hoursMembers.reduce((sum, m) => sum + m.hours, 0);

      ctx.body = {
        pendingEventsThisWeek: pendingEvents,
        draftEvents,
        openLoas,
        activePatrolSessions: activeSessions.length,
        monthLabel: `${MONTH_NAMES[month - 1]} ${year}`,
        monthHoursTotal,
        hoursMembers,
        activePatrols: activeSessions.map((s) => ({
          userId: s.userId,
          displayName: memberLabel(session.guildId, s.userId),
          startedAt: s.startedAt.toISOString(),
          channelId: s.channelId,
        })),
        recentCases: recentCases.map((c) => ({
          id: c.id,
          caseNumber: c.caseNumber,
          type: c.type,
          targetId: c.targetId,
          moderatorId: c.moderatorId,
          reason: c.reason,
          createdAt: c.createdAt.toISOString(),
          staffLogUrl:
            c.logThreadId && c.logMessageId
              ? `https://discord.com/channels/${session.guildId}/${c.logThreadId}/${c.logMessageId}`
              : null,
        })),
      };
    });
  }

  @Get("/api/dashboard/admin/hours/:userId")
  async adminHours(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireStaff(session);

      const targetId = ctx.params.userId;
      if (!targetId || !/^\d{17,20}$/.test(targetId)) {
        jsonError(ctx, 400, "Invalid user id.");
        return;
      }

      const year = parseInt(String(ctx.query.year ?? ""), 10);
      const month = parseInt(String(ctx.query.month ?? ""), 10);
      const now = new Date();
      const y = Number.isFinite(year) ? year : now.getUTCFullYear();
      const m = Number.isFinite(month) ? month : now.getUTCMonth() + 1;

      const totalMs = await patrolTimer.getUserTotalForMonth(
        session.guildId,
        targetId,
        y,
        m,
      );
      const allTimeMs = await patrolTimer.getUserTotal(session.guildId, targetId);

      logDashboardSessionAction(
        session,
        "Viewed member hours",
        `Looked up patrol hours for <@${targetId}>.`,
        [
          { name: "Target", value: `<@${targetId}> (\`${targetId}\`)`, inline: true },
          {
            name: "Month",
            value: `${MONTH_NAMES[m - 1]} ${y}`,
            inline: true,
          },
        ],
      );

      ctx.body = {
        userId: targetId,
        year: y,
        month: m,
        label: `${MONTH_NAMES[m - 1]} ${y}`,
        hours: msToHours(totalMs),
        allTimeHours: msToHours(allTimeMs),
      };
    });
  }

  @Post("/api/dashboard/admin/hours/:userId")
  async adminAdjustHours(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireStaff(session);

      if (!session.member || !(await hasNode(session.member, "patrol.command.manage"))) {
        jsonError(ctx, 403, "Missing patrol.command.manage permission.");
        return;
      }

      const targetId = ctx.params.userId;
      if (!targetId || !/^\d{17,20}$/.test(targetId)) {
        jsonError(ctx, 400, "Invalid user id.");
        return;
      }

      const body = ctx.request.body as {
        deltaMs?: number;
        year?: number;
        month?: number;
      } | undefined;

      const deltaMs = body?.deltaMs;
      if (typeof deltaMs !== "number" || !Number.isFinite(deltaMs) || deltaMs === 0) {
        jsonError(ctx, 400, "deltaMs must be a non-zero number.");
        return;
      }

      const now = new Date();
      const year = body?.year ?? now.getUTCFullYear();
      const month = body?.month ?? now.getUTCMonth() + 1;

      await patrolTimer.adjustUserTime(
        session.guildId,
        targetId,
        Math.trunc(deltaMs),
        year,
        month,
      );

      const totalMs = await patrolTimer.getUserTotalForMonth(
        session.guildId,
        targetId,
        year,
        month,
      );

      const hoursDelta = msToHours(Math.trunc(deltaMs));
      logDashboardSessionAction(
        session,
        "Patrol hours adjusted",
        `Adjusted hours for <@${targetId}> via the Activity dashboard.`,
        [
          { name: "Target", value: `<@${targetId}> (\`${targetId}\`)`, inline: true },
          {
            name: "Delta",
            value: `${hoursDelta >= 0 ? "+" : ""}${hoursDelta}h`,
            inline: true,
          },
          {
            name: "Month",
            value: `${MONTH_NAMES[month - 1]} ${year}`,
            inline: true,
          },
          {
            name: "New total",
            value: `${msToHours(totalMs)}h`,
            inline: true,
          },
        ],
        "mod",
      );

      ctx.body = {
        userId: targetId,
        year,
        month,
        hours: msToHours(totalMs),
      };
    });
  }

  @Get("/api/dashboard/admin/modlogs/:userId")
  async adminModlogs(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireStaff(session);

      const targetId = ctx.params.userId;
      if (!targetId || !/^\d{17,20}$/.test(targetId)) {
        jsonError(ctx, 400, "Invalid user id.");
        return;
      }

      const [cases, notes] = await Promise.all([
        modCaseManager.getCasesForUser(session.guildId, targetId, 50),
        prisma.modUserNote.findMany({
          where: { guildId: session.guildId, targetId },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
      ]);

      logDashboardSessionAction(
        session,
        "Viewed mod logs",
        `Opened moderation history for <@${targetId}>.`,
        [
          { name: "Target", value: `<@${targetId}> (\`${targetId}\`)`, inline: true },
          { name: "Cases", value: String(cases.length), inline: true },
          { name: "Notes", value: String(notes.length), inline: true },
        ],
        "mod",
      );

      ctx.body = {
        cases: cases.map((c) => ({
          id: c.id,
          caseNumber: c.caseNumber,
          type: c.type,
          targetId: c.targetId,
          moderatorId: c.moderatorId,
          reason: c.reason,
          claimedBy: c.claimedBy,
          active: c.active,
          createdAt: c.createdAt.toISOString(),
        })),
        notes: notes.map((n) => ({
          id: n.id,
          authorId: n.authorId,
          content: n.content,
          createdAt: n.createdAt.toISOString(),
        })),
      };
    });
  }
}

type HostEventBody = {
  title: string;
  time: string;
  duty: EventDuty;
  eventType?: EventType | null;
  durationMinutes: number;
  coHostId?: string | null;
  force: boolean;
};

function parseHostEventBody(
  ctx: Context,
): { ok: true; data: HostEventBody } | { ok: false; error: string } {
  const body = ctx.request.body as Record<string, unknown> | undefined;
  if (!body) {
    return { ok: false, error: "Missing request body." };
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return { ok: false, error: "Title is required." };
  }

  const time = typeof body.time === "string" ? body.time.trim() : "";
  if (!time) {
    return { ok: false, error: "Time is required." };
  }

  const dutyRaw = body.duty;
  const duty =
    dutyRaw === "OFF_DUTY" || dutyRaw === "offduty"
      ? EventDuty.OFF_DUTY
      : EventDuty.ON_DUTY;

  let durationMinutes =
    typeof body.durationMinutes === "number"
      ? body.durationMinutes
      : defaultDurationMinutes(duty);

  if (!isDurationAllowedForDuty(durationMinutes, duty)) {
    durationMinutes = defaultDurationMinutes(duty);
  }

  let eventType: EventType | null = null;
  if (typeof body.eventType === "string" && body.eventType) {
    eventType = parseEventTypeOption(body.eventType) ?? null;
  }

  const coHostId =
    typeof body.coHostId === "string" && /^\d{17,20}$/.test(body.coHostId)
      ? body.coHostId
      : null;

  const force = body.force === true;

  return {
    ok: true,
    data: {
      title,
      time,
      duty,
      eventType,
      durationMinutes,
      coHostId,
      force,
    },
  };
}
