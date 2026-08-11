import { Message, PartialMessage } from "discord.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { auditLogManager, prisma } from "../../main.js";
import { loggers } from "../../utility/logger.js";
import { DEFAULT_MESSAGE_RETENTION_DAYS } from "./loggingTypes.js";

export type CachedAttachmentMeta = {
  id: string;
  name: string;
  /** Durable URL when retained; empty when Discord CDN link was not persisted. */
  url: string;
  proxyURL?: string;
  contentType?: string | null;
  size: number;
  /** False when attachment bytes were not copied to durable storage. */
  retained?: boolean;
};

export type CachedMessageSnapshot = {
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  content: string | null;
  attachments: CachedAttachmentMeta[];
  embeds: unknown[];
  stickers: { id: string; name: string; format: string }[];
  createdAt: Date;
  editedAt: Date | null;
};

const PURGE_BATCH_SIZE = 5000;

/**
 * Persist attachment metadata only — Discord CDN URLs expire and are not durable.
 */
function serializeAttachments(message: Message | PartialMessage): CachedAttachmentMeta[] {
  if (!message.attachments) {
    return [];
  }
  return [...message.attachments.values()].map((a) => ({
    id: a.id,
    name: a.name,
    url: "",
    contentType: a.contentType,
    size: a.size,
    retained: false,
  }));
}

function serializeStickers(message: Message | PartialMessage) {
  if (!message.stickers) {
    return [];
  }
  return [...message.stickers.values()].map((s) => ({
    id: s.id,
    name: s.name,
    format: String(s.format),
  }));
}

function rowToSnapshot(row: {
  guildId: string;
  channelId: string;
  messageId: string;
  authorId: string;
  content: string | null;
  attachments: unknown;
  embeds: unknown;
  stickers: unknown;
  createdAt: Date;
  editedAt: Date | null;
}): CachedMessageSnapshot {
  return {
    guildId: row.guildId,
    channelId: row.channelId,
    messageId: row.messageId,
    authorId: row.authorId,
    content: row.content,
    attachments: (row.attachments as CachedAttachmentMeta[] | null) ?? [],
    embeds: (row.embeds as unknown[]) ?? [],
    stickers:
      (row.stickers as CachedMessageSnapshot["stickers"] | null) ?? [],
    createdAt: row.createdAt,
    editedAt: row.editedAt,
  };
}

export class MessageArchiveManager {
  async getRetentionDays(guildId: string): Promise<number> {
    const settings = await auditLogManager.getSettings(guildId);
    const days = settings?.messageArchiveRetentionDays;
    if (typeof days === "number" && days > 0) {
      return days;
    }
    return DEFAULT_MESSAGE_RETENTION_DAYS;
  }

  computeExpiresAt(retentionDays: number, from = new Date()): Date {
    return new Date(from.getTime() + retentionDays * 24 * 60 * 60 * 1000);
  }

  async upsertFromMessage(message: Message): Promise<void> {
    if (!message.guildId || message.author.bot) {
      return;
    }

    const roleIds = message.member?.roles.cache.keys();
    if (
      await auditLogManager.shouldIgnoreAuthor(
        message.guildId,
        message.author.id,
        roleIds,
      )
    ) {
      return;
    }

    try {
      const retentionDays = await this.getRetentionDays(message.guildId);
      const expiresAt = this.computeExpiresAt(retentionDays);
      const attachments = serializeAttachments(message);
      const embeds = message.embeds.map((e) => e.toJSON()) as unknown as Prisma.InputJsonValue;
      const stickers = serializeStickers(message) as unknown as Prisma.InputJsonValue;

      await prisma.cachedMessage.upsert({
        where: { messageId: message.id },
        update: {
          content: message.content || null,
          attachments: attachments as Prisma.InputJsonValue,
          embeds,
          stickers,
          editedAt: message.editedAt,
          expiresAt,
        },
        create: {
          guildId: message.guildId,
          channelId: message.channelId,
          messageId: message.id,
          authorId: message.author.id,
          content: message.content || null,
          attachments: attachments as Prisma.InputJsonValue,
          embeds,
          stickers,
          createdAt: message.createdAt,
          editedAt: message.editedAt,
          expiresAt,
        },
      });
    } catch (error) {
      loggers.bot.debug("Failed to cache message", {
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getByMessageId(messageId: string): Promise<CachedMessageSnapshot | null> {
    const row = await prisma.cachedMessage.findUnique({ where: { messageId } });
    if (!row) {
      return null;
    }
    return rowToSnapshot(row);
  }

  async getByMessageIds(messageIds: string[]): Promise<CachedMessageSnapshot[]> {
    if (messageIds.length === 0) {
      return [];
    }
    const rows = await prisma.cachedMessage.findMany({
      where: { messageId: { in: messageIds } },
    });
    return rows.map(rowToSnapshot);
  }

  async snapshotFromDiscord(
    message: Message | PartialMessage,
  ): Promise<CachedMessageSnapshot | null> {
    if (!message.guildId || !message.id) {
      return null;
    }
    const authorId = message.author?.id;
    if (!authorId) {
      return this.getByMessageId(message.id);
    }
    return {
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
      authorId,
      content: message.content ?? null,
      attachments: serializeAttachments(message),
      embeds: message.embeds?.map((e) => e.toJSON()) ?? [],
      stickers: serializeStickers(message),
      createdAt: message.createdAt ?? new Date(),
      editedAt: message.editedAt ?? null,
    };
  }

  async deleteCached(messageId: string): Promise<void> {
    await prisma.cachedMessage.deleteMany({ where: { messageId } });
  }

  async deleteCachedMany(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) {
      return;
    }
    await prisma.cachedMessage.deleteMany({
      where: { messageId: { in: messageIds } },
    });
  }

  buildPurgeTxt(
    channelId: string,
    snapshots: CachedMessageSnapshot[],
  ): string {
    const lines: string[] = [
      `Purge archive for channel ${channelId}`,
      `Messages: ${snapshots.length}`,
      `Generated: ${new Date().toISOString()}`,
      "",
      "-----",
      "",
    ];

    const sorted = [...snapshots].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    for (const snap of sorted) {
      lines.push(`[${snap.createdAt.toISOString()}] ${snap.authorId} (${snap.messageId})`);
      lines.push(snap.content || "(no content)");
      if (snap.attachments.length) {
        lines.push(
          `Attachments: ${snap.attachments
            .map((a) =>
              a.retained && a.url
                ? `${a.name} <${a.url}>`
                : `${a.name} (content not retained)`,
            )
            .join(", ")}`,
        );
      }
      if (snap.stickers.length) {
        lines.push(
          `Stickers: ${snap.stickers.map((s) => s.name).join(", ")}`,
        );
      }
      if (snap.embeds.length) {
        lines.push(`Embeds: ${snap.embeds.length}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  async storePurgeArchive(options: {
    guildId: string;
    channelId: string;
    moderatorId: string;
    snapshots: CachedMessageSnapshot[];
    txtContent: string;
    logMessageId?: string | null;
    logThreadId?: string | null;
    caseId?: number | null;
  }) {
    const retentionDays = await this.getRetentionDays(options.guildId);
    return prisma.messagePurgeArchive.create({
      data: {
        guildId: options.guildId,
        channelId: options.channelId,
        moderatorId: options.moderatorId,
        messageCount: options.snapshots.length,
        txtContent: options.txtContent,
        logMessageId: options.logMessageId ?? null,
        logThreadId: options.logThreadId ?? null,
        caseId: options.caseId ?? null,
        expiresAt: this.computeExpiresAt(retentionDays),
      },
    });
  }

  async purgeExpired(): Promise<{ messages: number; archives: number }> {
    const now = new Date();
    let messages = 0;
    let archives = 0;

    for (;;) {
      const batch = await prisma.cachedMessage.findMany({
        where: { expiresAt: { lt: now } },
        select: { id: true },
        take: PURGE_BATCH_SIZE,
      });
      if (batch.length === 0) {
        break;
      }
      const result = await prisma.cachedMessage.deleteMany({
        where: { id: { in: batch.map((r) => r.id) } },
      });
      messages += result.count;
      if (batch.length < PURGE_BATCH_SIZE) {
        break;
      }
    }

    for (;;) {
      const batch = await prisma.messagePurgeArchive.findMany({
        where: { expiresAt: { lt: now } },
        select: { id: true },
        take: PURGE_BATCH_SIZE,
      });
      if (batch.length === 0) {
        break;
      }
      const result = await prisma.messagePurgeArchive.deleteMany({
        where: { id: { in: batch.map((r) => r.id) } },
      });
      archives += result.count;
      if (batch.length < PURGE_BATCH_SIZE) {
        break;
      }
    }

    return { messages, archives };
  }
}
