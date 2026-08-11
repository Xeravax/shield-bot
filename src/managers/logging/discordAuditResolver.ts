import {
  AuditLogEvent,
  Guild,
  GuildAuditLogsEntry,
  User,
} from "discord.js";
import { loggers } from "../../utility/logger.js";

export type ResolvedAuditActor = {
  executor: User | null;
  reason: string | null;
  entry: GuildAuditLogsEntry | null;
};

type CacheEntry = {
  expiresAt: number;
  result: ResolvedAuditActor;
};

const CACHE_TTL_MS = 8_000;
const DEFAULT_AGE_MS = 15_000;

/**
 * Fetches Discord audit log entries with target match + age window,
 * caching recent lookups to reduce rate-limit pressure.
 */
export class DiscordAuditResolver {
  private readonly cache = new Map<string, CacheEntry>();

  async resolve(
    guild: Guild,
    type: AuditLogEvent,
    options?: {
      targetId?: string;
      maxAgeMs?: number;
      limit?: number;
    },
  ): Promise<ResolvedAuditActor> {
    const maxAgeMs = options?.maxAgeMs ?? DEFAULT_AGE_MS;
    const limit = options?.limit ?? 6;
    const cacheKey = `${guild.id}:${type}:${options?.targetId ?? "*"}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    try {
      const logs = await guild.fetchAuditLogs({ type, limit });
      const cutoff = Date.now() - maxAgeMs;
      const entry =
        logs.entries.find((e) => {
          if (e.createdTimestamp < cutoff) {
            return false;
          }
          if (!options?.targetId) {
            return true;
          }
          const target = e.target as { id?: string } | null;
          return target?.id === options.targetId;
        }) ?? null;

      const executor =
        entry?.executor && "tag" in entry.executor
          ? (entry.executor as User)
          : null;
      const result: ResolvedAuditActor = {
        executor,
        reason: entry?.reason ?? null,
        entry,
      };
      this.cache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        result,
      });
      return result;
    } catch (error) {
      loggers.bot.debug("Audit log lookup failed", {
        guildId: guild.id,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      return { executor: null, reason: null, entry: null };
    }
  }

  clearCache(guildId?: string): void {
    if (!guildId) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${guildId}:`)) {
        this.cache.delete(key);
      }
    }
  }
}
