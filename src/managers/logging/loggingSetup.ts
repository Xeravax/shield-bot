import {
  ChannelType,
  Client,
  ForumChannel,
  Guild,
  OverwriteType,
  PermissionFlagsBits,
  ThreadChannel,
  type GuildBasedChannel,
} from "discord.js";
import { prisma } from "../../main.js";
import { loggers } from "../../utility/logger.js";
import {
  LOGGING_THREAD_KEYS,
  LOGGING_THREAD_NAMES,
  parseLoggingThreadIds,
  type LoggingThreadKey,
} from "./loggingTypes.js";

export type LoggingSetupResult = {
  forumChannelId: string;
  threadIds: Record<LoggingThreadKey, string>;
  createdForum: boolean;
};

const DEFAULT_FORUM_NAME = "staff-logs";

function isForumChannel(channel: GuildBasedChannel | null): channel is ForumChannel {
  return !!channel && channel.type === ChannelType.GuildForum;
}

function normalizeChannelName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Creates or binds the staff logging forum and ensures persistent category threads.
 */
export class LoggingSetupManager {
  private readonly ensureThreadsInFlight = new Map<
    string,
    Promise<Record<LoggingThreadKey, string>>
  >();

  constructor(private readonly client: Client) {}

  async createSetup(guild: Guild): Promise<LoggingSetupResult> {
    const existingForum = guild.channels.cache.find(
      (ch): ch is ForumChannel =>
        isForumChannel(ch) &&
        normalizeChannelName(ch.name) === normalizeChannelName(DEFAULT_FORUM_NAME),
    );

    if (existingForum) {
      loggers.bot.info(
        `Reusing existing logging forum ${existingForum.id} in ${guild.id}`,
      );
      return this.bindForum(guild, existingForum.id);
    }

    const me = guild.members.me;
    const forum = await guild.channels.create({
      name: DEFAULT_FORUM_NAME,
      type: ChannelType.GuildForum,
      topic: "Staff audit and moderation logs (bot-managed category threads).",
      permissionOverwrites: [
        {
          id: guild.id,
          type: OverwriteType.Role,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        ...(me
          ? [
              {
                id: me.id,
                type: OverwriteType.Member as const,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.EmbedLinks,
                  PermissionFlagsBits.AttachFiles,
                  PermissionFlagsBits.ManageThreads,
                  PermissionFlagsBits.CreatePublicThreads,
                  PermissionFlagsBits.ReadMessageHistory,
                ],
              },
            ]
          : []),
      ],
    });

    await prisma.guildSettings.upsert({
      where: { guildId: guild.id },
      update: { loggingForumChannelId: forum.id },
      create: { guildId: guild.id, loggingForumChannelId: forum.id },
    });

    const threadIds = await this.ensureThreads(guild, forum.id, {});
    await prisma.guildSettings.upsert({
      where: { guildId: guild.id },
      update: {
        loggingForumChannelId: forum.id,
        loggingThreadIds: threadIds,
      },
      create: {
        guildId: guild.id,
        loggingForumChannelId: forum.id,
        loggingThreadIds: threadIds,
      },
    });

    return {
      forumChannelId: forum.id,
      threadIds,
      createdForum: true,
    };
  }

  async bindForum(
    guild: Guild,
    forumChannelId: string,
  ): Promise<LoggingSetupResult> {
    const channel = await guild.channels.fetch(forumChannelId).catch(() => null);
    if (!isForumChannel(channel)) {
      throw new Error("Channel must be a forum channel.");
    }

    const existing = await prisma.guildSettings.findUnique({
      where: { guildId: guild.id },
      select: { loggingThreadIds: true },
    });
    const threadIds = await this.ensureThreads(
      guild,
      forumChannelId,
      parseLoggingThreadIds(existing?.loggingThreadIds),
    );

    await prisma.guildSettings.upsert({
      where: { guildId: guild.id },
      update: {
        loggingForumChannelId: forumChannelId,
        loggingThreadIds: threadIds,
      },
      create: {
        guildId: guild.id,
        loggingForumChannelId: forumChannelId,
        loggingThreadIds: threadIds,
      },
    });

    return {
      forumChannelId,
      threadIds,
      createdForum: false,
    };
  }

  /**
   * Ensures all category threads exist for the guild's configured forum.
   * Recreates missing threads and persists updated IDs.
   */
  async ensureThreadsForGuild(
    guildId: string,
  ): Promise<Record<LoggingThreadKey, string> | null> {
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId },
      select: { loggingForumChannelId: true, loggingThreadIds: true },
    });
    if (!settings?.loggingForumChannelId) {
      return null;
    }

    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      return null;
    }

    const threadIds = await this.ensureThreads(
      guild,
      settings.loggingForumChannelId,
      parseLoggingThreadIds(settings.loggingThreadIds),
    );

    await prisma.guildSettings.update({
      where: { guildId },
      data: { loggingThreadIds: threadIds },
    });

    return threadIds;
  }

  async ensureThreads(
    guild: Guild,
    forumChannelId: string,
    existing: Partial<Record<LoggingThreadKey, string>>,
  ): Promise<Record<LoggingThreadKey, string>> {
    const inFlightKey = `${guild.id}:${forumChannelId}`;
    const inFlight = this.ensureThreadsInFlight.get(inFlightKey);
    if (inFlight) {
      return inFlight;
    }

    const op = this.ensureThreadsUncached(guild, forumChannelId, existing).finally(
      () => {
        this.ensureThreadsInFlight.delete(inFlightKey);
      },
    );
    this.ensureThreadsInFlight.set(inFlightKey, op);
    return op;
  }

  private async listForumThreads(
    forum: ForumChannel,
  ): Promise<Map<string, ThreadChannel>> {
    const byName = new Map<string, ThreadChannel>();

    const active = await forum.threads.fetchActive().catch(() => null);
    if (active) {
      for (const thread of active.threads.values()) {
        byName.set(normalizeChannelName(thread.name), thread);
      }
    }

    // Archived posts still count — reuse instead of duplicating.
    let before: string | undefined;
    for (let page = 0; page < 5; page++) {
      const archived = await forum.threads
        .fetchArchived({ type: "public", fetchAll: false, before })
        .catch(() => null);
      if (!archived || archived.threads.size === 0) {
        break;
      }
      for (const thread of archived.threads.values()) {
        const key = normalizeChannelName(thread.name);
        if (!byName.has(key)) {
          byName.set(key, thread);
        }
      }
      if (!archived.hasMore) {
        break;
      }
      const oldest = [...archived.threads.values()].sort(
        (a, b) => (a.archiveTimestamp ?? 0) - (b.archiveTimestamp ?? 0),
      )[0];
      before = oldest?.id;
      if (!before) {
        break;
      }
    }

    return byName;
  }

  private async adoptThread(thread: ThreadChannel): Promise<void> {
    if (thread.archived) {
      await thread.setArchived(false).catch(() => undefined);
    }
  }

  private async ensureThreadsUncached(
    guild: Guild,
    forumChannelId: string,
    existing: Partial<Record<LoggingThreadKey, string>>,
  ): Promise<Record<LoggingThreadKey, string>> {
    const forum = await guild.channels.fetch(forumChannelId).catch(() => null);
    if (!isForumChannel(forum)) {
      throw new Error("Logging forum channel is missing or not a forum.");
    }

    const threadsByName = await this.listForumThreads(forum);
    const claimedIds = new Set<string>();
    const result = {} as Record<LoggingThreadKey, string>;

    for (const key of LOGGING_THREAD_KEYS) {
      const expectedName = LOGGING_THREAD_NAMES[key];
      const existingId = existing[key];

      if (existingId) {
        const thread = await guild.channels.fetch(existingId).catch(() => null);
        if (
          thread &&
          thread.isThread() &&
          thread.parentId === forum.id &&
          !claimedIds.has(thread.id)
        ) {
          await this.adoptThread(thread);
          result[key] = thread.id;
          claimedIds.add(thread.id);
          threadsByName.delete(normalizeChannelName(thread.name));
          continue;
        }
      }

      const byName = threadsByName.get(normalizeChannelName(expectedName));
      if (byName && !claimedIds.has(byName.id)) {
        await this.adoptThread(byName);
        result[key] = byName.id;
        claimedIds.add(byName.id);
        threadsByName.delete(normalizeChannelName(expectedName));
        loggers.bot.info(`Reusing logging thread ${key} in ${guild.id}`, {
          threadId: byName.id,
        });
        continue;
      }

      const created = await forum.threads.create({
        name: expectedName,
        message: {
          content: `**${expectedName}** log thread — managed by the bot. Do not delete.`,
        },
        reason: `Ensure logging category thread: ${key}`,
      });
      result[key] = created.id;
      claimedIds.add(created.id);
      loggers.bot.info(`Created logging thread ${key} in ${guild.id}`, {
        threadId: created.id,
      });
    }

    return result;
  }
}
