import {
  Client,
  ChannelType,
  Guild,
  GuildMember,
  VoiceChannel,
  VoiceState,
  EmbedBuilder,
  Colors,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  TextChannel,
} from "discord.js";
import { prisma } from "../../main.js";
import { loggers } from "../../utility/logger.js";
import { loaManager } from "../../main.js";

/** Single rank-based promotion rule (current rank -> next rank at required hours, optional cooldown) */
export interface PromotionRule {
  currentRankRoleId: string;
  nextRankRoleId: string;
  requiredHours: number;
  cooldownHours?: number;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Strip to only a-z, 0-9, . and , so role names can't inject formatting. */
function scrubRoleDisplay(name: string): string {
  return name.replace(/[^a-zA-Z0-9.,]/g, "") || name;
}

type TrackedUser = {
  userId: string;
  channelId: string;
  startedAt: Date;
};

type TopUserResult = {
  userId: string;
  totalMs: bigint | number;
};

export class PatrolTimerManager {
  private client: Client;
  // guildId => Map<userId, TrackedUser>
  private tracked: Map<string, Map<string, TrackedUser>> = new Map();
  // guildId => Set<userId> for paused users
  private pausedUsers: Map<string, Set<string>> = new Map();
  // guildId => boolean for guild-wide pause
  private pausedGuilds: Set<string> = new Set();

  constructor(client: Client) {
    this.client = client;
  }

  async init() {
    // Warm tracked maps for all guilds the bot is in
    for (const guild of this.client.guilds.cache.values()) {
      this.tracked.set(guild.id, new Map());
    }

    // Load persisted active sessions
    const activeSessions = await prisma.activeVoicePatrolSession.findMany();
    for (const session of activeSessions) {
      if (!this.tracked.has(session.guildId))
        {this.tracked.set(session.guildId, new Map());}
      const guildMap = this.tracked.get(session.guildId);
      if (guildMap) {
        guildMap.set(session.userId, {
          userId: session.userId,
          channelId: session.channelId,
          startedAt: session.startedAt,
        });
      }
    }

    // On startup, scan current voice states and resume tracking for members
    // already connected to channels within the configured category.
    for (const guild of this.client.guilds.cache.values()) {
      try {
        await this.resumeActiveForGuild(guild);
      } catch (err) {
        loggers.patrol.error(
          `Failed to resume active sessions for guild ${guild.id}`,
          err,
        );
      }
    }
  }

  // Settings helpers
  async getSettings(guildId: string) {
    let settings = await prisma.guildSettings.findUnique({
      where: { guildId },
    });
    if (!settings) {
      settings = await prisma.guildSettings.create({
        data: { guildId },
      });
    }
    // One-time backfill from legacy VoicePatrolSettings table if present
    if (!settings.patrolChannelCategoryId) {
      try {
        const rows = await prisma
          .$queryRaw`SELECT channelCategoryId FROM VoicePatrolSettings WHERE guildId = ${guildId} LIMIT 1`;
        const legacy = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        if (legacy) {
          const patch: Record<string, unknown> = {};
          if (legacy.channelCategoryId && !settings.patrolChannelCategoryId)
            {patch.patrolChannelCategoryId = legacy.channelCategoryId as string;}
          if (Object.keys(patch).length > 0) {
            settings = await prisma.guildSettings.update({
              where: { guildId },
              data: patch,
            });
          }
        }
      } catch (_) {
        // ignore if table doesn't exist
      }
    }
    return settings as {
      guildId: string;
      patrolChannelCategoryId?: string | null;
      promotionChannelId?: string | null;
      promotionMinHours?: number | null;
      promotionRecruitRoleId?: string | null;
      promotionRules?: PromotionRule[] | null;
      patrolLogChannelId?: string | null;
      loaNotificationChannelId?: string | null;
      staffRoleIds?: unknown;
    };
  }

  /**
   * Resolve effective promotion rules: use promotionRules array if non-empty, else legacy single rule.
   */
  getEffectivePromotionRules(settings: {
    promotionRules?: unknown;
    promotionRecruitRoleId?: string | null;
    promotionMinHours?: number | null;
  }): PromotionRule[] | null {
    const rules = settings.promotionRules as PromotionRule[] | null | undefined;
    if (Array.isArray(rules) && rules.length > 0) {
      return rules;
    }
    if (settings.promotionRecruitRoleId && settings.promotionMinHours != null) {
      return [{
        currentRankRoleId: settings.promotionRecruitRoleId,
        nextRankRoleId: "", // legacy: no next rank id, message uses "Deputy"
        requiredHours: settings.promotionMinHours,
        cooldownHours: undefined,
      }];
    }
    return null;
  }

  /**
   * Get when the user obtained the given role (for promotion cooldown: hours since obtaining role).
   * Returns null if we have no record (e.g. they had the role before the bot recorded it).
   */
  async getRoleObtainedAt(guildId: string, discordId: string, roleId: string): Promise<Date | null> {
    const row = await prisma.voicePatrolRoleObtainedAt.findUnique({
      where: {
        guildId_userId_roleId: { guildId, userId: discordId, roleId },
      },
      select: { obtainedAt: true },
    });
    return row?.obtainedAt ?? null;
  }

  async setBotuserRole(_guildId: string, _roleId: string | null) {
    // patrolBotuserRoleId field was removed from schema
    // This method is kept for backward compatibility but does nothing
  }

  async setCategory(guildId: string, categoryId: string | null) {
    await this.getSettings(guildId); // ensure row
    await prisma.guildSettings.update({
      where: { guildId },
      data: { patrolChannelCategoryId: categoryId ?? null },
    });
  }

  // Core tracking

  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
    try {
      const guild = newState.guild || oldState.guild;
      if (!guild) {return;}
      const guildId = guild.id;
      const member = newState.member || oldState.member;
      if (!member || member.user.bot) {return;}
      const settings = await this.getSettings(guildId);
      if (!settings.patrolChannelCategoryId) {return;} // not configured

      const leftChannelId = oldState.channelId;
      const joinedChannelId = newState.channelId;

      // Ensure map
      if (!this.tracked.has(guildId)) {this.tracked.set(guildId, new Map());}
      // Map is created above, using it for channel checks
      // const _guildMap = this.tracked.get(guildId)!;

      // Helper to check if a channel is in tracked category
      const isInTrackedCategory = (cid: string | null | undefined) => {
        if (!cid) {return false;}
        const ch = guild.channels.cache.get(cid);
        if (!ch || ch.type !== ChannelType.GuildVoice) {return false;}
        return (
          (ch as VoiceChannel).parentId === settings.patrolChannelCategoryId
        );
      };

      const wasTracked = isInTrackedCategory(leftChannelId);
      const nowTracked = isInTrackedCategory(joinedChannelId);

      // If moving from one patrol channel to another patrol channel, update channelId without resetting
      if (wasTracked && nowTracked && leftChannelId !== joinedChannelId && joinedChannelId) {
        const guildMap = this.tracked.get(guildId);
        const tracked = guildMap?.get(member.id);
        if (tracked) {
          // Update the channelId in the tracking map
          tracked.channelId = joinedChannelId;
          // Update persisted session
          await prisma.activeVoicePatrolSession
            .upsert({
              where: { guildId_userId: { guildId, userId: member.id } },
              update: { channelId: joinedChannelId },
              create: { guildId, userId: member.id, channelId: joinedChannelId, startedAt: tracked.startedAt },
            })
            .catch((err: unknown) =>
              loggers.patrol.error("Failed to update session channel", err),
            );
        }
        return; // Don't stop/start tracking, just update channel
      }

      // If leaving a tracked channel, stop and persist
      if (wasTracked && !nowTracked) {
        await this.stopTrackingAndPersist(guildId, member, leftChannelId);
      }

      // If joining a tracked channel, start tracking
      if (nowTracked && !wasTracked) {
        if (joinedChannelId) {
          // Check for LOA before starting tracking
          void this.checkLOAAndStartTracking(guild, guildId, member, joinedChannelId, settings).catch((err) =>
            loggers.patrol.error("Error in checkLOAAndStartTracking", err),
          );
        }
      }
    } catch (err) {
      loggers.patrol.error("voiceStateUpdate error", err);
    }
  }

  private startTracking(
    guildId: string,
    member: GuildMember,
    channelId: string,
  ) {
    if (member.user.bot) {return;}
    if (!this.tracked.has(guildId)) {this.tracked.set(guildId, new Map());}
    const guildMap = this.tracked.get(guildId);
    if (!guildMap) {return;}
    // Avoid clobbering an existing tracking session (e.g., during startup scan)
    if (guildMap.has(member.id)) {return;}
    const startedAt = new Date();
    guildMap.set(member.id, { userId: member.id, channelId, startedAt });
    // Persist to DB
    prisma.activeVoicePatrolSession
      .upsert({
        where: { guildId_userId: { guildId, userId: member.id } },
        update: { channelId, startedAt },
        create: { guildId, userId: member.id, channelId, startedAt },
      })
      .catch((err: unknown) =>
        loggers.patrol.error("Failed to persist session", err),
      );
    // console.log(`[PatrolTimer] Start ${member.user.tag} in ${channelId}`);
  }

  private async stopTrackingAndPersist(guildId: string, member: GuildMember, leftChannelId?: string | null) {
    const guildMap = this.tracked.get(guildId);
    if (!guildMap) {return;}
    const tracked = guildMap.get(member.id);
    if (!tracked) {return;}
    
    guildMap.delete(member.id);
    
    // Don't persist time if user is paused or on LOA
    if (await this.isUserPausedOrOnLOA(guildId, member.id)) {
      // Delete persisted session
      await prisma.activeVoicePatrolSession
        .deleteMany({
          where: { guildId, userId: member.id },
        })
        .catch((err: unknown) =>
          loggers.patrol.error("Failed to delete session", err),
        );
      return;
    }
    
    // If switching channels within same category, we still finalize from old channel
    const nowMs = Date.now();
    const delta = nowMs - tracked.startedAt.getTime();
    if (delta < 3000) {return;} // ignore very short joins; parity with original impl
    // Delete persisted session
    await prisma.activeVoicePatrolSession
      .deleteMany({
        where: { guildId, userId: member.id },
      })
      .catch((err: unknown) =>
        loggers.patrol.error("Failed to delete session", err),
      );
    // Ensure a corresponding User row exists for this Discord ID
    await this.ensureUser(member.id);
    // Use the tracked channelId or fall back to leftChannelId parameter
    const channelIdForLogging = tracked.channelId || leftChannelId || null;
    // Upsert DB row and increment time
    await prisma.voicePatrolTime.upsert({
      where: { guildId_userId: { guildId, userId: member.id } },
      update: { totalMs: { increment: BigInt(delta) }, channelId: channelIdForLogging },
      create: { guildId, userId: member.id, totalMs: BigInt(delta), channelId: channelIdForLogging },
    });

    // Also persist monthly totals, splitting across month boundaries (UTC)
    await this.persistMonthly(
      guildId,
      member.id,
      tracked.startedAt,
      new Date(nowMs),
    );

    // Log patrol completion
    await this.logPatrolCompletion(guildId, member.id, delta, channelIdForLogging);

    // Send DM notification if user hasn't opted out
    await this.sendPatrolCompletionDM(member, delta, channelIdForLogging);

    // Check for promotion eligibility
    await this.checkPromotion(guildId, member);
  }

  /** Scan the guild's voice channels within the tracked category and resume tracking for present members. */
  private async resumeActiveForGuild(guild: Guild): Promise<void> {
    const settings = await this.getSettings(guild.id);
    if (!settings.patrolChannelCategoryId) {return;}

    // Find all voice channels under the tracked category
    const voiceChannels = guild.channels.cache.filter(
      (c): c is VoiceChannel =>
        c?.type === ChannelType.GuildVoice &&
        (c as VoiceChannel).parentId === settings.patrolChannelCategoryId,
    );

    if (!voiceChannels.size) {return;}

    const trackedUsers = new Set<string>();

    for (const ch of voiceChannels.values()) {
      // ch.members contains members currently connected to this voice channel
      for (const member of ch.members.values()) {
        if (member.user.bot) {continue;}
        trackedUsers.add(member.id);
        this.startTracking(guild.id, member, ch.id);
      }
    }

    // Stop tracking for users who have persisted sessions but are no longer in a tracked channel
    const guildMap = this.tracked.get(guild.id);
    if (guildMap) {
      for (const [userId, _tracked] of guildMap.entries()) {
        if (!trackedUsers.has(userId)) {
          // User left while bot was down, stop and persist
          const member = guild.members.cache.get(userId);
          if (member) {
            // Get channelId from tracked data
            const tracked = guildMap.get(userId);
            await this.stopTrackingAndPersist(guild.id, member, tracked?.channelId);
          } else {
            // Member not in cache, perhaps left guild, just delete session
            guildMap.delete(userId);
            await prisma.activeVoicePatrolSession
              .deleteMany({
                where: { guildId: guild.id, userId },
              })
              .catch((err: unknown) =>
                loggers.patrol.error("Failed to delete session", err),
              );
          }
        }
      }
    }
  }

  // Commands
  async getCurrentTrackedList(guildId: string) {
    const guildMap = this.tracked.get(guildId);
    if (!guildMap)
      {return [] as Array<{ userId: string; ms: number; channelId: string }>;}
    const now = Date.now();
    const arr: Array<{ userId: string; ms: number; channelId: string }> = [];
    for (const tu of guildMap.values()) {
      // Show 0ms if paused or on LOA
      const isPausedOrOnLOA = this.isUserPaused(guildId, tu.userId) || await this.isUserPausedOrOnLOA(guildId, tu.userId);
      const ms = isPausedOrOnLOA 
        ? 0 
        : now - tu.startedAt.getTime();
      arr.push({
        userId: tu.userId,
        channelId: tu.channelId,
        ms,
      });
    }
    return arr;
  }

  async getTop(guildId: string, limit?: number) {
    const rows = await prisma.voicePatrolTime.findMany({
      where: { guildId },
      orderBy: { totalMs: "desc" },
      take: undefined, // we'll sort after adding live deltas
    });

    // Merge live tracked deltas
    const now = Date.now();
    const guildMap = this.tracked.get(guildId);
    const byUser: Record<string, number> = {};

    for (const r of rows) {
      byUser[r.userId] = Number(r.totalMs);
    }
    if (guildMap) {
      for (const tu of guildMap.values()) {
        // Only add delta if user is not paused or on LOA
        if (!this.isUserPaused(guildId, tu.userId) && !(await this.isUserPausedOrOnLOA(guildId, tu.userId))) {
          const delta = now - tu.startedAt.getTime();
          if (delta > 0) {byUser[tu.userId] = (byUser[tu.userId] ?? 0) + delta;}
        }
      }
    }

    // To array and sort desc
    const arr = Object.entries(byUser)
      .map(([userId, totalMs]) => ({ userId, totalMs }))
      .sort((a, b) => b.totalMs - a.totalMs);

    const limited =
      limit && limit > 0 ? arr.slice(0, Math.min(limit, 1000)) : arr;

    // Return in a shape similar to prisma rows expected by command code
    return limited.map((r) => ({
      userId: r.userId,
      totalMs: BigInt(Math.max(0, Math.floor(r.totalMs))),
    }));
  }

  async getTopByMonth(
    guildId: string,
    year: number,
    month: number,
    limit?: number,
  ): Promise<Array<TopUserResult>> {
    const rows = await prisma.voicePatrolMonthlyTime.findMany({
      where: { guildId, year, month },
      orderBy: { totalMs: "desc" },
      take: undefined,
    });
    // Merge live delta if querying the current UTC month
    const now = new Date();
    const isCurrentMonth =
      now.getUTCFullYear() === year && now.getUTCMonth() + 1 === month;
    if (!isCurrentMonth) {
      const limited =
        limit && limit > 0 ? rows.slice(0, Math.min(limit, 1000)) : rows;
      // Convert Prisma rows to consistent shape
      return limited.map((r) => ({
        userId: r.userId,
        totalMs: r.totalMs,
      }));
    }

    const monthStart = new Date(
      Date.UTC(year, month - 1, 1, 0, 0, 0, 0),
    ).getTime();
    const nowMs = now.getTime();
    const guildMap = this.tracked.get(guildId);
    const byUser: Record<string, number> = {};

    for (const r of rows) {byUser[r.userId] = Number(r.totalMs);}

    if (guildMap) {
      for (const tu of guildMap.values()) {
        // Only add delta if user is not paused or on LOA
        if (!this.isUserPaused(guildId, tu.userId) && !(await this.isUserPausedOrOnLOA(guildId, tu.userId))) {
          const startMs = Math.max(tu.startedAt.getTime(), monthStart);
          const delta = Math.max(0, nowMs - startMs);
          if (delta > 0) {byUser[tu.userId] = (byUser[tu.userId] ?? 0) + delta;}
        }
      }
    }

    const arr = Object.entries(byUser)
      .map(([userId, totalMs]) => ({ userId, totalMs }))
      .sort((a, b) => b.totalMs - a.totalMs);
    const limited =
      limit && limit > 0 ? arr.slice(0, Math.min(limit, 1000)) : arr;
    return limited.map((r) => ({
      userId: r.userId,
      totalMs: BigInt(Math.max(0, Math.floor(r.totalMs))),
    }));
  }

  async getTopByYear(
    guildId: string,
    year: number,
    limit?: number,
  ): Promise<Array<TopUserResult>> {
    // Get all monthly records for this year
    const rows = await prisma.voicePatrolMonthlyTime.findMany({
      where: { guildId, year },
      orderBy: { totalMs: "desc" },
      take: undefined,
    });

    // Aggregate by user (sum across all months in the year)
    const byUser: Record<string, number> = {};
    for (const r of rows) {
      byUser[r.userId] = (byUser[r.userId] ?? 0) + Number(r.totalMs);
    }

    // Merge live delta if querying the current UTC year
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    const isCurrentYear = currentYear === year;

    if (isCurrentYear) {
      const guildMap = this.tracked.get(guildId);
      if (guildMap) {
        const monthStart = new Date(
          Date.UTC(year, currentMonth - 1, 1, 0, 0, 0, 0),
        ).getTime();
        const nowMs = now.getTime();
        
        for (const tu of guildMap.values()) {
          // Only add delta if user is not paused
          if (!this.isUserPaused(guildId, tu.userId) && !(await this.isUserPausedOrOnLOA(guildId, tu.userId))) {
            const startMs = Math.max(tu.startedAt.getTime(), monthStart);
            const delta = Math.max(0, nowMs - startMs);
            if (delta > 0) {
              byUser[tu.userId] = (byUser[tu.userId] ?? 0) + delta;
            }
          }
        }
      }
    }

    // To array and sort desc
    const arr = Object.entries(byUser)
      .map(([userId, totalMs]) => ({ userId, totalMs }))
      .sort((a, b) => b.totalMs - a.totalMs);

    const limited =
      limit && limit > 0 ? arr.slice(0, Math.min(limit, 1000)) : arr;

    return limited.map((r) => ({
      userId: r.userId,
      totalMs: BigInt(Math.max(0, Math.floor(r.totalMs))),
    }));
  }

  async getUserTotalForMonth(
    guildId: string,
    userId: string,
    year: number,
    month: number,
  ) {
    const row = await prisma.voicePatrolMonthlyTime.findUnique({
      where: { guildId_userId_year_month: { guildId, userId, year, month } },
    });
    let base = row?.totalMs ? Number(row.totalMs) : 0;

    // Add live delta for current month if user is currently tracked and not paused or on LOA
    const now = new Date();
    const isCurrentMonth =
      now.getUTCFullYear() === year && now.getUTCMonth() + 1 === month;
    if (isCurrentMonth && !this.isUserPaused(guildId, userId) && !(await this.isUserPausedOrOnLOA(guildId, userId))) {
      const guildMap = this.tracked.get(guildId);
      const tu = guildMap?.get(userId);
      if (tu) {
        const monthStart = new Date(
          Date.UTC(year, month - 1, 1, 0, 0, 0, 0),
        ).getTime();
        const startMs = Math.max(tu.startedAt.getTime(), monthStart);
        const delta = Math.max(0, Date.now() - startMs);
        base += delta;
      }
    }
    return base;
  }

  async getUserTotalForYear(
    guildId: string,
    userId: string,
    year: number,
  ) {
    // Get all monthly records for this user in this year
    const rows = await prisma.voicePatrolMonthlyTime.findMany({
      where: { guildId, userId, year },
      select: { totalMs: true, month: true },
    });
    
    let total = 0;
    for (const row of rows) {
      total += Number(row.totalMs);
    }

    // Add live delta for current month if user is currently tracked and not paused or on LOA
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    if (year === currentYear && !this.isUserPaused(guildId, userId) && !(await this.isUserPausedOrOnLOA(guildId, userId))) {
      const guildMap = this.tracked.get(guildId);
      const tu = guildMap?.get(userId);
      if (tu) {
        const monthStart = new Date(
          Date.UTC(year, currentMonth - 1, 1, 0, 0, 0, 0),
        ).getTime();
        const startMs = Math.max(tu.startedAt.getTime(), monthStart);
        const delta = Math.max(0, Date.now() - startMs);
        total += delta;
      }
    }
    
    return total;
  }

  async getTopForChannel(guild: Guild, channelId: string) {
    // Get members in this voice channel
    const members = guild.members.cache.filter(
      (m) => !m.user.bot && m.voice?.channelId === channelId,
    );
    const ids = members.map((m) => m.id);
    if (ids.length === 0) {return [];}
    const rows = await prisma.voicePatrolTime.findMany({
      where: { guildId: guild.id, userId: { in: ids } },
      orderBy: { totalMs: "desc" },
    });

    const now = Date.now();
    const guildMap = this.tracked.get(guild.id);
    const byUser: Record<string, number> = {};

    for (const r of rows) {
      byUser[r.userId] = Number(r.totalMs);
    }
    if (guildMap) {
      for (const tu of guildMap.values()) {
        if (tu.channelId !== channelId) {continue;} // only add deltas for this channel
        if (!ids.includes(tu.userId)) {continue;}
        // Only add delta if user is not paused or on LOA
        if (!this.isUserPaused(guild.id, tu.userId) && !(await this.isUserPausedOrOnLOA(guild.id, tu.userId))) {
          const delta = now - tu.startedAt.getTime();
          if (delta > 0) {byUser[tu.userId] = (byUser[tu.userId] ?? 0) + delta;}
        }
      }
    }

    const arr = Object.entries(byUser)
      .map(([userId, totalMs]) => ({ userId, totalMs }))
      .sort((a, b) => b.totalMs - a.totalMs);

    return arr.map((r) => ({
      userId: r.userId,
      totalMs: BigInt(Math.max(0, Math.floor(r.totalMs))),
    }));
  }

  async reset(guildId: string, userId?: string) {
    if (userId) {
      // Clear database records
      await prisma.voicePatrolTime.updateMany({
        where: { guildId, userId },
        data: { totalMs: BigInt(0) },
      });
      await prisma.activeVoicePatrolSession.deleteMany({
        where: { guildId, userId },
      });
      
      // Clear in-memory tracking for this specific user
      const guildMap = this.tracked.get(guildId);
      if (guildMap) {
        const tracked = guildMap.get(userId);
        if (tracked) {
          // Reset their start time to now instead of deleting,
          // so they continue being tracked if still in channel
          tracked.startedAt = new Date();
        }
      }
    } else {
      // Clear database records for all users
      await prisma.voicePatrolTime.updateMany({
        where: { guildId },
        data: { totalMs: BigInt(0) },
      });
      await prisma.activeVoicePatrolSession.deleteMany({
        where: { guildId },
      });
      
      // Clear in-memory tracking for all users in this guild
      const guildMap = this.tracked.get(guildId);
      if (guildMap) {
        const now = new Date();
        for (const tracked of guildMap.values()) {
          // Reset their start time to now instead of deleting,
          // so they continue being tracked if still in channel
          tracked.startedAt = now;
        }
      }
    }
  }

  async getUserTotal(guildId: string, userId: string) {
    const row = await prisma.voicePatrolTime.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    let base = row?.totalMs ? Number(row.totalMs) : 0;
    // Add live delta if user is not paused or on LOA
    if (!this.isUserPaused(guildId, userId) && !(await this.isUserPausedOrOnLOA(guildId, userId))) {
      const guildMap = this.tracked.get(guildId);
      const tu = guildMap?.get(userId);
      if (tu) {
        const delta = Date.now() - tu.startedAt.getTime();
        base += delta;
      }
    }
    return base;
  }

  /**
   * Pause time tracking for a specific user.
   * Persists their current time and prevents further accumulation.
   * Returns true if successful, false if user has active timer.
   */
  async pauseUser(guildId: string, userId: string): Promise<boolean> {
    // Check if user is currently tracked (active timer)
    const guildMap = this.tracked.get(guildId);
    const tracked = guildMap?.get(userId);
    if (tracked) {
      return false; // Cannot pause while user has active timer
    }

    // Add to paused set
    if (!this.pausedUsers.has(guildId)) {
      this.pausedUsers.set(guildId, new Set());
    }
    const pausedSet = this.pausedUsers.get(guildId);
    if (pausedSet) {
      pausedSet.add(userId);
    }
    
    return true;
  }

  /**
   * Unpause time tracking for a specific user.
   */
  async unpauseUser(guildId: string, userId: string) {
    const paused = this.pausedUsers.get(guildId);
    if (paused) {
      paused.delete(userId);
    }

    // Reset their start time if they're currently tracked
    const guildMap = this.tracked.get(guildId);
    const tracked = guildMap?.get(userId);
    if (tracked) {
      tracked.startedAt = new Date();
    }
  }

  /**
   * Pause time tracking for all users in the guild.
   * Returns true if successful, false if any users have active timers.
   */
  async pauseGuild(guildId: string): Promise<boolean> {
    // Check if any users are currently tracked (have active timers)
    const guildMap = this.tracked.get(guildId);
    if (guildMap && guildMap.size > 0) {
      return false; // Cannot pause guild while users have active timers
    }

    this.pausedGuilds.add(guildId);
    return true;
  }

  /**
   * Unpause time tracking for all users in the guild.
   */
  async unpauseGuild(guildId: string) {
    this.pausedGuilds.delete(guildId);

    // Reset start times for all currently tracked users
    const guildMap = this.tracked.get(guildId);
    if (guildMap) {
      const now = new Date();
      for (const tracked of guildMap.values()) {
        tracked.startedAt = now;
      }
    }
  }

  /**
   * Check if a user is paused (either individually or guild-wide).
   * Note: This is synchronous and only checks the manual pause state.
   * For LOA checks, use isUserPausedOrOnLOA (async).
   */
  isUserPaused(guildId: string, userId: string): boolean {
    if (this.pausedGuilds.has(guildId)) {return true;}
    const paused = this.pausedUsers.get(guildId);
    return paused ? paused.has(userId) : false;
  }

  /**
   * Check if a user is paused or on LOA (async version for LOA checks).
   * Note: notificationsPaused controls only alerts, not tracking. Any active LOA pauses tracking.
   */
  private async isUserPausedOrOnLOA(guildId: string, userId: string): Promise<boolean> {
    // Check manual pause first (synchronous)
    if (this.isUserPaused(guildId, userId)) {return true;}
    
    // Check for active LOA (async) - any active LOA pauses tracking
    try {
      const loa = await loaManager.getActiveLOA(guildId, userId);
      return loa !== null;
    } catch (error) {
      loggers.patrol.error(`Error checking LOA for user ${userId} in guild ${guildId}`, error);
      return false; // On error, don't pause (fail open)
    }
  }

  /**
   * Check if the entire guild is paused.
   */
  isGuildPaused(guildId: string): boolean {
    return this.pausedGuilds.has(guildId);
  }

  /**
   * Adjust time for a specific user (add or subtract milliseconds).
   * @param guildId - Guild ID
   * @param userId - User ID
   * @param deltaMs - Milliseconds to add (positive) or subtract (negative)
   * @param year - Year to adjust (defaults to current year)
   * @param month - Month to adjust (defaults to current month)
   */
  async adjustUserTime(guildId: string, userId: string, deltaMs: number, year?: number, month?: number) {
    await this.ensureUser(userId);
    
    // Determine target year and month
    const now = new Date();
    const targetYear = year ?? now.getUTCFullYear();
    const targetMonth = month ?? (now.getUTCMonth() + 1);
    
    // Update all-time total
    const row = await prisma.voicePatrolTime.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });
    
    const currentTotal = row?.totalMs ? Number(row.totalMs) : 0;
    const newTotal = Math.max(0, currentTotal + deltaMs); // Don't go below 0
    
    await prisma.voicePatrolTime.upsert({
      where: { guildId_userId: { guildId, userId } },
      update: { totalMs: BigInt(newTotal) },
      create: { guildId, userId, totalMs: BigInt(newTotal) },
    });

    // Also adjust specified month's total
    const monthRow = await prisma.voicePatrolMonthlyTime.findUnique({
      where: { guildId_userId_year_month: { guildId, userId, year: targetYear, month: targetMonth } },
    });
    
    const currentMonthTotal = monthRow?.totalMs ? Number(monthRow.totalMs) : 0;
    const newMonthTotal = Math.max(0, currentMonthTotal + deltaMs);
    
    await prisma.voicePatrolMonthlyTime.upsert({
      where: { guildId_userId_year_month: { guildId, userId, year: targetYear, month: targetMonth } },
      update: { totalMs: BigInt(newMonthTotal) },
      create: { guildId, userId, year: targetYear, month: targetMonth, totalMs: BigInt(newMonthTotal) },
    });
  }

  /**
   * Get all years that have patrol data for this guild.
   * Returns array of objects with year, user count, and total hours.
   */
  async getAvailableYears(guildId: string): Promise<
    Array<{
      year: number;
      userCount: number;
      totalHours: number;
    }>
  > {
    // Get all records for this guild
    const records = await prisma.voicePatrolMonthlyTime.findMany({
      where: { guildId },
      select: {
        year: true,
        userId: true,
        totalMs: true,
      },
    });

    // Group by year and aggregate
    const yearMap = new Map<
      number,
      { userIds: Set<string>; totalMs: bigint }
    >();

    for (const record of records) {
      if (!yearMap.has(record.year)) {
        yearMap.set(record.year, {
          userIds: new Set(),
          totalMs: BigInt(0),
        });
      }
      const yearData = yearMap.get(record.year);
      if (yearData) {
        yearData.userIds.add(record.userId);
        yearData.totalMs += record.totalMs;
      }
    }

    // Convert to array and sort by year descending
    return Array.from(yearMap.entries())
      .map(([year, data]) => ({
        year,
        userCount: data.userIds.size,
        totalHours: Math.floor(Number(data.totalMs) / 1000 / 60 / 60),
      }))
      .sort((a, b) => b.year - a.year);
  }

  /**
   * Get all months that have patrol data for this guild (optionally filtered by year).
   * Returns array of objects with year, month, user count, and total hours.
   */
  async getAvailableMonths(
    guildId: string,
    year?: number,
  ): Promise<
    Array<{
      year: number;
      month: number;
      userCount: number;
      totalHours: number;
    }>
  > {
    const where: { guildId: string; year?: number } = { guildId };
    if (year !== undefined) {
      where.year = year;
    }

    const records = await prisma.voicePatrolMonthlyTime.findMany({
      where,
      select: {
        year: true,
        month: true,
        userId: true,
        totalMs: true,
      },
    });

    // Group by year+month and aggregate
    const monthMap = new Map<
      string,
      { year: number; month: number; userIds: Set<string>; totalMs: bigint }
    >();

    for (const record of records) {
      const key = `${record.year}-${record.month}`;
      if (!monthMap.has(key)) {
        monthMap.set(key, {
          year: record.year,
          month: record.month,
          userIds: new Set(),
          totalMs: BigInt(0),
        });
      }
      const monthData = monthMap.get(key);
      if (monthData) {
        monthData.userIds.add(record.userId);
        monthData.totalMs += record.totalMs;
      }
    }

    // Convert to array and sort by year/month descending
    return Array.from(monthMap.values())
      .map((data) => ({
        year: data.year,
        month: data.month,
        userCount: data.userIds.size,
        totalHours: Math.floor(Number(data.totalMs) / 1000 / 60 / 60),
      }))
      .sort((a, b) => {
        if (a.year !== b.year) {return b.year - a.year;}
        return b.month - a.month;
      });
  }

  /**
   * Format milliseconds to human-readable string (e.g., "1h 30m 45s")
   */
  private formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    const parts: string[] = [];
    if (days) {parts.push(`${days}d`);}
    if (hours) {parts.push(`${hours}h`);}
    if (minutes) {parts.push(`${minutes}m`);}
    if (seconds || parts.length === 0) {parts.push(`${seconds}s`);}
    return parts.join(" ");
  }

  /**
   * Send DM to user when patrol session completes (if not opted out)
   */
  private async sendPatrolCompletionDM(
    member: GuildMember,
    durationMs: number,
    channelId: string | null,
  ) {
    try {
      // Get user preferences
      const user = await prisma.user.findUnique({
        where: { discordId: member.id },
        include: { userPreferences: true },
      });

      // Check if user has opted out of patrol DMs
      if (user?.userPreferences?.patrolDmDisabled) {
        return; // User has opted out
      }

      // Try to get channel name
      const guild = member.guild;
      let channelName = "Unknown Channel";
      if (channelId) {
        const channel = guild.channels.cache.get(channelId);
        if (channel) {
          channelName = channel.name;
        }
      }

      const durationStr = this.formatDuration(durationMs);

      // Get monthly, yearly, and overall totals
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1;
      const monthlyTotal = await this.getUserTotalForMonth(
        guild.id,
        member.id,
        currentYear,
        currentMonth,
      );
      const yearlyTotal = await this.getUserTotalForYear(
        guild.id,
        member.id,
        currentYear,
      );
      const overallTotal = await this.getUserTotal(guild.id, member.id);

      const monthlyStr = this.formatDuration(monthlyTotal);
      const yearlyStr = this.formatDuration(yearlyTotal);
      const overallStr = this.formatDuration(overallTotal);

      // Create embed
      const embed = new EmbedBuilder()
        .setTitle("✅ Patrol Session Completed")
        .setDescription(
          `Your patrol session has ended.\n\n**Duration:** ${durationStr}\n**Channel:** ${channelName}`,
        )
        .addFields(
          { name: `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`, value: monthlyStr, inline: true },
          { name: `This Year (${currentYear})`, value: yearlyStr, inline: true },
          { name: "All-Time Total", value: overallStr, inline: true },
        )
        .setColor(Colors.Green)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Patrol System" })
        .setTimestamp();

      // Add button to disable DMs
      const disableButton = new ButtonBuilder()
        .setCustomId(`patrol-dm-disable:${member.id}`)
        .setLabel("Disable Patrol DM")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(disableButton);

      // Send DM
      try {
        await member.user.send({
          embeds: [embed],
          components: [row],
        });
        loggers.patrol.info(`Sent patrol completion DM to ${member.user.tag}`);
      } catch (dmError: unknown) {
        // If DM fails (user has DMs disabled, etc.), log but don't throw
        loggers.patrol.warn(`Failed to send patrol completion DM to ${member.id}`, dmError);
      }
    } catch (err) {
      loggers.patrol.error("sendPatrolCompletionDM error", err);
    }
  }

  /**
   * Log patrol completion to the configured log channel
   */
  private async logPatrolCompletion(
    guildId: string,
    userId: string,
    durationMs: number,
    channelId: string | null,
  ) {
    try {
      const settings = await this.getSettings(guildId);
      if (!settings.patrolLogChannelId) {
        return; // No log channel configured
      }

      const channel = await this.client.channels.fetch(settings.patrolLogChannelId);
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        loggers.patrol.warn(`Invalid patrol log channel ${settings.patrolLogChannelId} in guild ${guildId}`);
        return;
      }

      // Get channel name - channel is now guaranteed to be a guild text channel
      const textChannel = channel as TextChannel;
      const guild = textChannel.guild;
      let channelName = "Unknown Channel";
      if (channelId) {
        const patrolChannel = guild.channels.cache.get(channelId);
        if (patrolChannel) {
          channelName = patrolChannel.name;
        }
      }

      const durationStr = this.formatDuration(durationMs);

      // Get monthly, yearly, and overall totals
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1;
      const monthlyTotal = await this.getUserTotalForMonth(
        guildId,
        userId,
        currentYear,
        currentMonth,
      );
      const yearlyTotal = await this.getUserTotalForYear(
        guildId,
        userId,
        currentYear,
      );
      const overallTotal = await this.getUserTotal(guildId, userId);

      const monthlyStr = this.formatDuration(monthlyTotal);
      const yearlyStr = this.formatDuration(yearlyTotal);
      const overallStr = this.formatDuration(overallTotal);

      // Create log embed
      const embed = new EmbedBuilder()
        .setTitle("📊 Patrol Session Completed")
        .addFields(
          { name: "User", value: `<@${userId}>`, inline: true },
          { name: "Duration", value: durationStr, inline: true },
          { name: "Channel", value: channelName, inline: true },
          { name: `${MONTH_NAMES[currentMonth - 1]} ${currentYear}`, value: monthlyStr, inline: true },
          { name: `This Year (${currentYear})`, value: yearlyStr, inline: true },
          { name: "All-Time Total", value: overallStr, inline: true },
        )
        .setColor(Colors.Blue)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Patrol System" })
        .setTimestamp();

      await textChannel.send({ embeds: [embed] });
      loggers.patrol.debug(`Logged patrol completion for ${userId} in guild ${guildId}`);
    } catch (err) {
      loggers.patrol.error("logPatrolCompletion error", err);
    }
  }

  /**
   * Log command usage to the configured log channel
   */
  async logCommandUsage(
    guildId: string,
    action: string,
    executorId: string,
    targetUserId?: string,
    details?: string,
  ) {
    try {
      const settings = await this.getSettings(guildId);
      if (!settings.patrolLogChannelId) {
        return; // No log channel configured
      }

      const channel = await this.client.channels.fetch(settings.patrolLogChannelId);
      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        loggers.patrol.warn(`Invalid patrol log channel ${settings.patrolLogChannelId} in guild ${guildId}`);
        return;
      }

      // channel is now guaranteed to be a guild text channel
      const textChannel = channel as TextChannel;

      // Format action name for display
      const actionDisplay = action
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

      // Create log embed
      const embed = new EmbedBuilder()
        .setTitle("⚙️ Patrol Command Usage")
        .addFields(
          { name: "Action", value: actionDisplay, inline: true },
          { name: "Executor", value: `<@${executorId}>`, inline: true },
        )
        .setColor(Colors.Orange)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Patrol System" })
        .setTimestamp();

      if (targetUserId) {
        embed.addFields({ name: "Target User", value: `<@${targetUserId}>`, inline: true });
      }

      if (details) {
        embed.addFields({ name: "Details", value: details, inline: false });
      }

      await textChannel.send({ embeds: [embed] });
      loggers.patrol.debug(`Logged command usage: ${action} by ${executorId} in guild ${guildId}`);
    } catch (err) {
      loggers.patrol.error("logCommandUsage error", err);
    }
  }

  // Internals
  private async ensureUser(discordId: string) {
    try {
      await prisma.user.upsert({
        where: { discordId },
        create: { discordId },
        update: {},
      });
    } catch (e) {
      loggers.patrol.error("ensureUser failed", e);
    }
  }

  /**
   * Run promotion check for one member; send notification(s) if eligible.
   * Returns true if at least one notification was sent.
   * Used by automatic (on leave) and manual check command.
   */
  async runPromotionCheckForMember(guildId: string, member: GuildMember): Promise<boolean> {
    let sent = false;
    try {
      const settings = await this.getSettings(guildId);
      if (!settings.promotionChannelId) {
        return false;
      }
      const rules = this.getEffectivePromotionRules(settings);
      if (!rules || rules.length === 0) {
        return false;
      }
      const totalTime = await this.getUserTotal(guildId, member.id);
      const totalHours = totalTime / (1000 * 60 * 60);
      const channel = await member.guild.channels.fetch(settings.promotionChannelId);
      if (!channel || !channel.isTextBased()) {
        return false;
      }
      const isLegacyRule = (r: PromotionRule) => r.nextRankRoleId === "";

      for (const rule of rules) {
        if (!member.roles.cache.has(rule.currentRankRoleId)) continue;
        if (totalHours < rule.requiredHours) continue;
        if (rule.cooldownHours != null && rule.cooldownHours > 0) {
          const obtainedAt = await this.getRoleObtainedAt(guildId, member.id, rule.currentRankRoleId);
          if (obtainedAt === null) continue;
          const hoursSinceObtained = (Date.now() - obtainedAt.getTime()) / (1000 * 60 * 60);
          if (hoursSinceObtained < rule.cooldownHours) continue;
        }
        if (isLegacyRule(rule)) {
          const existing = await prisma.voicePatrolPromotion.findUnique({
            where: { guildId_userId: { guildId, userId: member.id } },
          });
          if (existing) continue;
          const message = `<@${member.id}>\nRecruit > Deputy\nAttended ${Math.floor(totalHours)}+ hours and been in 2+ patrols.`;
          const sentMessage = await channel.send(message);
          await sentMessage.react("✅");
          await sentMessage.react("❌");
          await prisma.voicePatrolPromotion.create({
            data: { guildId, userId: member.id, totalHours },
          });
          loggers.patrol.info(`Promotion notification sent for ${member.user.tag} (${totalHours.toFixed(2)}h)`);
          sent = true;
          return true;
        }
        const alreadyNotified = await prisma.voicePatrolPromotionNotification.findUnique({
          where: {
            guildId_userId_nextRankRoleId: { guildId, userId: member.id, nextRankRoleId: rule.nextRankRoleId },
          },
        });
        if (alreadyNotified) continue;
        const currentRankName = scrubRoleDisplay(
          member.guild.roles.cache.get(rule.currentRankRoleId)?.name ?? "Current",
        );
        const nextRankName = scrubRoleDisplay(
          member.guild.roles.cache.get(rule.nextRankRoleId)?.name ?? "Next",
        );
        const message = `<@${member.id}>\n${currentRankName} → ${nextRankName}\nAttended ${totalHours.toFixed(1)}+ hours (required: ${rule.requiredHours}h).`;
        const sentMessage = await channel.send(message);
        await sentMessage.react("✅");
        await sentMessage.react("❌");
        await prisma.voicePatrolPromotionNotification.create({
          data: {
            guildId,
            userId: member.id,
            nextRankRoleId: rule.nextRankRoleId,
            totalHoursAtNotify: totalHours,
          },
        });
        loggers.patrol.info(`Promotion notification sent for ${member.user.tag}: ${currentRankName} → ${nextRankName} (${totalHours.toFixed(2)}h)`);
        sent = true;
      }
    } catch (err) {
      loggers.patrol.error("runPromotionCheckForMember error", err);
    }
    return sent;
  }

  /**
   * Check if a user is eligible for promotion and send notification if so (called on patrol leave).
   */
  private async checkPromotion(guildId: string, member: GuildMember): Promise<void> {
    await this.runPromotionCheckForMember(guildId, member);
  }

  private async persistMonthly(
    guildId: string,
    userId: string,
    startedAt: Date,
    endedAt: Date,
  ) {
    // Split [startedAt, endedAt) across months in UTC and increment each bucket
    let curStart = new Date(startedAt);
    const endMs = endedAt.getTime();

    while (curStart.getTime() < endMs) {
      const y = curStart.getUTCFullYear();
      const m = curStart.getUTCMonth(); // 0-11
      const nextMonthStart = new Date(
        Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, 1, 0, 0, 0, 0),
      );
      const segmentEndMs = Math.min(endMs, nextMonthStart.getTime());
      const segDelta = segmentEndMs - curStart.getTime();
      if (segDelta > 0) {
        await prisma.voicePatrolMonthlyTime.upsert({
          where: {
            guildId_userId_year_month: {
              guildId,
              userId,
              year: y,
              month: m + 1,
            },
          },
          update: { totalMs: { increment: BigInt(segDelta) } },
          create: {
            guildId,
            userId,
            year: y,
            month: m + 1,
            totalMs: BigInt(segDelta),
          },
        });
      }
      curStart = new Date(segmentEndMs);
    }
  }

  /**
   * Check for LOA, notify staff if needed, and start tracking only if not on LOA.
   */
  private async checkLOAAndStartTracking(
    guild: Guild,
    guildId: string,
    member: GuildMember,
    channelId: string,
    settings: Awaited<ReturnType<typeof this.getSettings>>,
  ): Promise<void> {
    // Check if user is manually paused first
    // If manually paused, don't start tracking and don't trigger LOA alerts/DMs
    if (this.isUserPaused(guildId, member.id)) {
      // User is manually paused - don't start tracking, don't alert staff, don't DM user
      return;
    }
    
    // Check if user is on LOA (only if not manually paused)
    const loa = await loaManager.getActiveLOA(guildId, member.id);
    const isOnLOA = loa !== null;
    
    if (isOnLOA) {
      // User is on LOA - notify staff but don't start tracking
      await this.checkLOAAndNotify(guild, guildId, member.id, channelId, settings);
      
      // Inform user that their time won't be tracked (unless notifications are paused)
      if (loa && !loa.notificationsPaused) {
        await this.notifyUserAboutLOATracking(member.id);
      }
      return;
    }
    
    // User is not on LOA and not manually paused - start tracking normally
    this.startTracking(guildId, member, channelId);
  }

  /**
   * Send a DM to the user informing them that their time won't be tracked during LOA.
   */
  private async notifyUserAboutLOATracking(userId: string): Promise<void> {
    try {
      const user = await this.client.users.fetch(userId);
      const embed = new EmbedBuilder()
        .setTitle("⚠️ LOA Time Tracking Paused")
        .setDescription(
          "You've joined a patrol channel while on Leave of Absence. Your patrol time **will not be tracked** during your LOA period.",
        )
        .addFields({
          name: "Want to Resume Tracking?",
          value: "If you'd like to end your LOA early and resume time tracking, please refer back to your original LOA request message and click the **\"End Early\"** button.",
        })
        .setColor(Colors.Orange)
        .setTimestamp();

      await user.send({ embeds: [embed] });
      loggers.patrol.info(`Sent LOA tracking notification to user ${userId}`);
    } catch (error) {
      // User may have DMs disabled, which is fine - just log it
      loggers.patrol.debug(`Could not DM user ${userId} about LOA tracking pause: ${error}`);
    }
  }

  private async checkLOAAndNotify(
    guild: Guild,
    guildId: string,
    userId: string,
    channelId: string,
    settings: Awaited<ReturnType<typeof this.getSettings>>,
  ): Promise<void> {
    try {
      const loa = await loaManager.getActiveLOA(guildId, userId);

      if (!loa || loa.notificationsPaused) {
        return; // No active LOA or notifications paused
      }

      // Use settings passed in (from handleVoiceStateUpdate which already called getSettings)
      if (!settings?.loaNotificationChannelId) {
        loggers.patrol.debug(`LOA notification channel not configured for guild ${guildId}`);
        return;
      }

      // Validate and coerce staff role IDs with runtime check
      let staffRoleIds: string[] = [];
      if (settings.staffRoleIds !== null && settings.staffRoleIds !== undefined) {
        if (Array.isArray(settings.staffRoleIds)) {
          // Filter and coerce to strings, only accepting primitive values
          staffRoleIds = settings.staffRoleIds
            .filter((item: unknown) => item !== null && item !== undefined && (typeof item === "string" || typeof item === "number" || typeof item === "boolean"))
            .map((item: unknown) => String(item));
        } else {
          loggers.patrol.warn(
            `Expected staffRoleIds to be an array for guild ${guildId}, got ${typeof settings.staffRoleIds}. Using empty array.`,
          );
        }
      }

      if (staffRoleIds.length === 0) {
        loggers.patrol.debug(`No staff roles configured for guild ${guildId}`);
        return;
      }

      // Get notification channel (use passed-in guild object)
      const channel = await guild.channels.fetch(settings.loaNotificationChannelId);

      if (!channel || !channel.isTextBased()) {
        loggers.patrol.warn(`Invalid LOA notification channel ${settings.loaNotificationChannelId} for guild ${guildId}`);
        return;
      }

      // Build staff mention
      const staffMentions = staffRoleIds.map((roleId) => `<@&${roleId}>`).join(" ");

      // Get channel name for display
      const patrolChannel = guild.channels.cache.get(channelId);
      const channelName = patrolChannel?.name || "Unknown Channel";

      // Create embed
      const embed = new EmbedBuilder()
        .setTitle("⚠️ LOA Alert")
        .setDescription(`A user on Leave of Absence has joined a patrol channel.`)
        .addFields(
          {
            name: "User",
            value: `<@${userId}>`,
            inline: true,
          },
          {
            name: "Channel",
            value: `<#${channelId}> (${channelName})`,
            inline: true,
          },
          {
            name: "Status",
            value: "Time tracking is paused for this user",
            inline: false,
          },
        )
        .setColor(Colors.Orange)
        .setTimestamp();

      // Send notification
      await channel.send({
        content: `${staffMentions}`,
        embeds: [embed],
        allowedMentions: {},
      });

      loggers.patrol.info(`Sent LOA notification for user ${userId} joining patrol in guild ${guildId}`);
    } catch (error) {
      loggers.patrol.error("Error checking LOA and notifying staff", error);
    }
  }
}
// No default export; a singleton is created and exported from main.ts
