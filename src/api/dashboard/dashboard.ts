import { Get, Post, Put, Router } from "@discordx/koa";
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
  runEventValidation,
} from "../../managers/events/eventPlanningManager.js";
import { getGuildCalendarFeedUrl } from "../../managers/events/discordEventCalendarFeed.js";
import { hasNode } from "../../utility/permissionNodes.js";
import {
  bearerToken,
  DashboardAuthError,
  DashboardConfigError,
  DashboardForbiddenError,
  exchangeOAuthCode,
  resolveDashboardMember,
  setDashboardCors,
} from "../../utility/dashboard/auth.js";
import {
  buildDashboardSession,
  countMembersWithNode,
  requireHost,
  requireShieldMember,
  requireStaff,
} from "../../utility/dashboard/session.js";
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

function msToHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 100) / 100;
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

      // Only published/exported Discord events — not draft, pending, denied, or
      // approved-but-not-yet-exported planning rows.
      const rows = await prisma.plannedEvent.findMany({
        where: {
          guildId: session.guildId,
          discordEventId: { not: null },
          startTime: { gte: from, lte: to },
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
        events: rows.map((e) => ({
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
          status: "PUBLISHED",
          discordEventId: e.discordEventId,
        })),
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
      const timezone = session.timezone;
      const startTime = resolveDraftStartTime(data.time, timezone, {
        enforceWeek: !data.force,
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
          forceOverride: data.force,
          editResumeStatus: null,
          editSnapshot: null,
          editStartedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        guild,
        data.force,
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
      const startTime = resolveDraftStartTime(data.time, session.timezone, {
        enforceWeek: !data.force,
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
          forceOverride: data.force,
        },
      });

      const guild = bot.guilds.cache.get(session.guildId) ?? null;
      const validation = await runEventValidation(event, guild, data.force);

      ctx.body = {
        eventId: event.id,
        startTime: event.startTime.toISOString(),
        validation,
      };
    });
  }

  @Get("/api/dashboard/admin/overview")
  async adminOverview(ctx: Context): Promise<void> {
    await withDashboardAuth(ctx, async (session) => {
      await requireStaff(session);

      const week = getCurrentEventWeekRange();
      const [recruitPlus, deputyPlus, pendingEvents, draftEvents, openLoas, recentCases, activeSessions] =
        await Promise.all([
          countMembersWithNode(session.guildId, "patrol.tracked"),
          countMembersWithNode(session.guildId, "patrol.avatar"),
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
            take: 10,
            select: {
              id: true,
              caseNumber: true,
              type: true,
              targetId: true,
              moderatorId: true,
              reason: true,
              createdAt: true,
            },
          }),
          prisma.activeVoicePatrolSession.count({
            where: { guildId: session.guildId },
          }),
        ]);

      ctx.body = {
        recruitPlus,
        deputyPlus,
        pendingEventsThisWeek: pendingEvents,
        draftEvents,
        openLoas,
        activePatrolSessions: activeSessions,
        recentCases: recentCases.map((c) => ({
          ...c,
          createdAt: c.createdAt.toISOString(),
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
