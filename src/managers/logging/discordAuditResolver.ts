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
  /** Audit entry id for consume-after-successful-post; null when unresolved. */
  entryId: string | null;
};

type CacheEntry = {
  expiresAt: number;
  createdAt: number;
  maxAgeMs: number;
  result: ResolvedAuditActor;
};

const CACHE_TTL_MS = 8_000;
const DEFAULT_AGE_MS = 15_000;
const MAX_CACHE_SIZE = 500;

/**
 * Fetches Discord audit log entries with target match + age window,
 * caching recent lookups to reduce rate-limit pressure.
 */
export class DiscordAuditResolver {
  private readonly cache = new Map<string, CacheEntry>();

  private pruneExpired(now = Date.now()): void {
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  private enforceMaxSize(): void {
    if (this.cache.size <= MAX_CACHE_SIZE) {
      return;
    }
    const overflow = this.cache.size - MAX_CACHE_SIZE;
    const keys = this.cache.keys();
    for (let i = 0; i < overflow; i++) {
      const next = keys.next();
      if (next.done) {
        break;
      }
      this.cache.delete(next.value);
    }
  }

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
    const cacheKey = `${guild.id}:${type}:${options?.targetId ?? "*"}:${maxAgeMs}:${limit}`;
    const now = Date.now();

    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (cached.expiresAt <= now) {
        this.cache.delete(cacheKey);
      } else {
        const cutoff = now - maxAgeMs;
        const entryTs = cached.result.entry?.createdTimestamp;
        if (
          !cached.result.entry ||
          (typeof entryTs === "number" && entryTs >= cutoff)
        ) {
          return cached.result;
        }
        // Cached match is older than caller's cutoff - treat as miss.
        this.cache.delete(cacheKey);
      }
    } else {
      this.pruneExpired(now);
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
          if (e.targetId === options.targetId) {
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
        entryId: entry?.id ?? null,
      };
      this.cache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        createdAt: Date.now(),
        maxAgeMs,
        result,
      });
      this.enforceMaxSize();
      return result;
    } catch (error) {
      loggers.bot.debug("Audit log lookup failed", {
        guildId: guild.id,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      return { executor: null, reason: null, entry: null, entryId: null };
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
