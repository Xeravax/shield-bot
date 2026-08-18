import { prisma } from "../../main.js";
import { loggers } from "../../utility/logger.js";

const CONSUMED_TTL_MS = 30_000;
const MAX_CONSUMED = 2_000;

type ConsumedEntry = { expiresAt: number };

/**
 * Tracks recently handled Discord audit log entry ids so the safety net
 * does not double-post when a gateway handler already logged the action.
 * Also persists a per-guild cursor for ready/resume catch-up.
 */
export class AuditLogSeen {
  private readonly consumed = new Map<string, ConsumedEntry>();

  private key(guildId: string, entryId: string): string {
    return `${guildId}:${entryId}`;
  }

  private prune(now = Date.now()): void {
    for (const [key, entry] of this.consumed) {
      if (entry.expiresAt <= now) {
        this.consumed.delete(key);
      }
    }
    if (this.consumed.size <= MAX_CONSUMED) {
      return;
    }
    const overflow = this.consumed.size - MAX_CONSUMED;
    const keys = this.consumed.keys();
    for (let i = 0; i < overflow; i++) {
      const next = keys.next();
      if (next.done) {
        break;
      }
      this.consumed.delete(next.value);
    }
  }

  /** Mark an audit entry as already logged (in-memory only). */
  consume(guildId: string, entryId: string): void {
    this.prune();
    this.consumed.set(this.key(guildId, entryId), {
      expiresAt: Date.now() + CONSUMED_TTL_MS,
    });
  }

  /** Consume several ids; skips null, undefined, and empty strings. */
  consumeMany(
    guildId: string,
    ids: Iterable<string | null | undefined>,
  ): void {
    for (const id of ids) {
      if (id) {
        this.consume(guildId, id);
      }
    }
  }

  wasConsumed(guildId: string, entryId: string): boolean {
    this.prune();
    const entry = this.consumed.get(this.key(guildId, entryId));
    if (!entry) {
      return false;
    }
    if (entry.expiresAt <= Date.now()) {
      this.consumed.delete(this.key(guildId, entryId));
      return false;
    }
    return true;
  }

  /**
   * Consume if not already consumed. Returns true when this call won
   * (caller should post); false when another path already handled it.
   */
  tryConsume(guildId: string, entryId: string): boolean {
    if (this.wasConsumed(guildId, entryId)) {
      return false;
    }
    this.consume(guildId, entryId);
    return true;
  }

  /** Snowflake string compare (Discord snowflakes are sortable as BigInt). */
  isAfter(entryId: string, cursorId: string | null | undefined): boolean {
    if (!cursorId) {
      return true;
    }
    try {
      return BigInt(entryId) > BigInt(cursorId);
    } catch {
      return entryId > cursorId;
    }
  }

  async getCursor(guildId: string): Promise<string | null> {
    try {
      const row = await prisma.guildSettings.findUnique({
        where: { guildId },
        select: { loggingLastAuditEntryId: true },
      });
      return row?.loggingLastAuditEntryId ?? null;
    } catch (error) {
      loggers.bot.debug("Failed to read loggingLastAuditEntryId", {
        guildId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async setCursor(guildId: string, entryId: string): Promise<void> {
    try {
      await prisma.guildSettings.updateMany({
        where: { guildId },
        data: { loggingLastAuditEntryId: entryId },
      });
    } catch (error) {
      loggers.bot.debug("Failed to persist loggingLastAuditEntryId", {
        guildId,
        entryId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Advance cursor only when entryId is newer than the stored value.
   * Uses a conditional MySQL UPDATE so concurrent handlers cannot overwrite
   * a newer cursor with an older snowflake.
   */
  async advanceCursor(guildId: string, entryId: string): Promise<void> {
    try {
      await prisma.$executeRaw`
        UPDATE \`GuildSettings\`
        SET loggingLastAuditEntryId = ${entryId}
        WHERE guildId = ${guildId}
          AND (
            loggingLastAuditEntryId IS NULL
            OR CAST(loggingLastAuditEntryId AS UNSIGNED) < CAST(${entryId} AS UNSIGNED)
          )
      `;
    } catch (error) {
      loggers.bot.debug("Failed to advance loggingLastAuditEntryId", {
        guildId,
        entryId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const auditLogSeen = new AuditLogSeen();
