import {
  ChannelType,
  Client,
  ForumChannel,
  Guild,
  OverwriteType,
  PermissionFlagsBits,
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

function isForumChannel(channel: GuildBasedChannel | null): channel is ForumChannel {
  return !!channel && channel.type === ChannelType.GuildForum;
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
    const me = guild.members.me;
    const forum = await guild.channels.create({
      name: "staff-logs",
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

  private async ensureThreadsUncached(
    guild: Guild,
    forumChannelId: string,
    existing: Partial<Record<LoggingThreadKey, string>>,
  ): Promise<Record<LoggingThreadKey, string>> {
    const forum = await guild.channels.fetch(forumChannelId).catch(() => null);
    if (!isForumChannel(forum)) {
      throw new Error("Logging forum channel is missing or not a forum.");
    }

    const result = {} as Record<LoggingThreadKey, string>;

    for (const key of LOGGING_THREAD_KEYS) {
      const existingId = existing[key];
      if (existingId) {
        const thread = await guild.channels.fetch(existingId).catch(() => null);
        if (
          thread &&
          thread.isThread() &&
          thread.parentId === forum.id
        ) {
          if (thread.archived) {
            await thread.setArchived(false).catch(() => undefined);
          }
          result[key] = thread.id;
          continue;
        }
      }

      const created = await forum.threads.create({
        name: LOGGING_THREAD_NAMES[key],
        message: {
          content: `**${LOGGING_THREAD_NAMES[key]}** log thread — managed by the bot. Do not delete.`,
        },
        reason: `Ensure logging category thread: ${key}`,
      });
      result[key] = created.id;
      loggers.bot.info(`Created logging thread ${key} in ${guild.id}`, {
        threadId: created.id,
      });
    }

    return result;
  }
}
