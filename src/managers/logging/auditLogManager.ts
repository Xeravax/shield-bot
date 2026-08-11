import {
  AttachmentBuilder,
  Client,
  EmbedBuilder,
  Guild,
  Message,
  ThreadChannel,
  type MessageCreateOptions,
} from "discord.js";
import { prisma } from "../../main.js";
import { loggers } from "../../utility/logger.js";
import { LoggingSetupManager } from "./loggingSetup.js";
import {
  LOGGING_COLORS,
  parseLoggingThreadIds,
  parseStringIdArray,
  type LoggingSeverity,
  type LoggingThreadKey,
} from "./loggingTypes.js";

export type PostLogOptions = {
  guildId: string;
  category: LoggingThreadKey;
  title: string;
  description?: string | null;
  severity?: LoggingSeverity;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: string;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  files?: AttachmentBuilder[];
  components?: MessageCreateOptions["components"];
  /** Skip posting when channel is the logging forum or an ignored channel. */
  sourceChannelId?: string | null;
};

export class AuditLogManager {
  constructor(
    private readonly client: Client,
    private readonly setup: LoggingSetupManager,
  ) {}

  async getSettings(guildId: string) {
    return prisma.guildSettings.findUnique({
      where: { guildId },
      select: {
        loggingForumChannelId: true,
        welcomeChannelId: true,
        loggingThreadIds: true,
        messageArchiveRetentionDays: true,
        loggingIgnoredChannelIds: true,
        loggingIgnoredRoleIds: true,
        inviteFilterEnabled: true,
        inviteFilterAction: true,
      },
    });
  }

  isLoggingChannel(channelId: string, forumId: string | null | undefined): boolean {
    return !!forumId && channelId === forumId;
  }

  async shouldIgnoreChannel(guildId: string, channelId: string): Promise<boolean> {
    const settings = await this.getSettings(guildId);
    if (!settings) {
      return true;
    }
    if (this.isLoggingChannel(channelId, settings.loggingForumChannelId)) {
      return true;
    }
    const ignored = parseStringIdArray(settings.loggingIgnoredChannelIds);
    return ignored.includes(channelId);
  }

  async shouldIgnoreAuthor(
    guildId: string,
    authorId: string,
    roleIds?: Iterable<string>,
  ): Promise<boolean> {
    const me = this.client.user?.id;
    if (me && authorId === me) {
      return true;
    }
    const settings = await this.getSettings(guildId);
    if (!settings) {
      return false;
    }
    const ignoredRoles = parseStringIdArray(settings.loggingIgnoredRoleIds);
    if (ignoredRoles.length === 0 || !roleIds) {
      return false;
    }
    for (const roleId of roleIds) {
      if (ignoredRoles.includes(roleId)) {
        return true;
      }
    }
    return false;
  }

  async resolveCategoryThread(
    guild: Guild,
    category: LoggingThreadKey,
  ): Promise<ThreadChannel | null> {
    const settings = await this.getSettings(guild.id);
    if (!settings?.loggingForumChannelId) {
      return null;
    }

    let threadIds = parseLoggingThreadIds(settings.loggingThreadIds);
    let threadId = threadIds[category];

    if (!threadId) {
      try {
        const ensured = await this.setup.ensureThreadsForGuild(guild.id);
        if (!ensured) {
          return null;
        }
        threadIds = ensured;
        threadId = ensured[category];
      } catch (error) {
        loggers.bot.warn("Failed to ensure logging threads", error);
        return null;
      }
    }

    if (!threadId) {
      return null;
    }

    let thread = await guild.channels.fetch(threadId).catch(() => null);
    if (!thread || !thread.isThread()) {
      try {
        const ensured = await this.setup.ensureThreadsForGuild(guild.id);
        threadId = ensured?.[category];
        if (!threadId) {
          return null;
        }
        thread = await guild.channels.fetch(threadId).catch(() => null);
      } catch (error) {
        loggers.bot.warn("Failed to recreate logging thread", error);
        return null;
      }
    }

    if (!thread || !thread.isThread()) {
      return null;
    }

    if (thread.archived) {
      await thread.setArchived(false).catch(() => undefined);
    }

    return thread;
  }

  buildEmbed(options: {
    title: string;
    description?: string | null;
    severity?: LoggingSeverity;
    fields?: { name: string; value: string; inline?: boolean }[];
    footer?: string;
    thumbnailUrl?: string | null;
    imageUrl?: string | null;
  }): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(LOGGING_COLORS[options.severity ?? "info"])
      .setTitle(options.title)
      .setTimestamp(new Date());

    if (options.description) {
      embed.setDescription(options.description.slice(0, 4096));
    }
    if (options.fields?.length) {
      embed.addFields(
        options.fields.map((f) => ({
          name: f.name.slice(0, 256),
          value: f.value.slice(0, 1024) || "—",
          inline: f.inline,
        })),
      );
    }
    if (options.footer) {
      embed.setFooter({ text: options.footer.slice(0, 2048) });
    }
    if (options.thumbnailUrl) {
      embed.setThumbnail(options.thumbnailUrl);
    }
    if (options.imageUrl) {
      embed.setImage(options.imageUrl);
    }
    return embed;
  }

  /**
   * Posts a log embed into the matching category thread. Soft-fails when unset.
   */
  async postLog(options: PostLogOptions): Promise<Message | null> {
    try {
      if (options.sourceChannelId) {
        const ignored = await this.shouldIgnoreChannel(
          options.guildId,
          options.sourceChannelId,
        );
        if (ignored) {
          return null;
        }
      }

      const guild = await this.client.guilds.fetch(options.guildId).catch(() => null);
      if (!guild) {
        return null;
      }

      const thread = await this.resolveCategoryThread(guild, options.category);
      if (!thread) {
        return null;
      }

      const embed = this.buildEmbed(options);
      return await thread.send({
        embeds: [embed],
        files: options.files,
        components: options.components,
      });
    } catch (error) {
      loggers.bot.warn("Failed to post audit log", error);
      return null;
    }
  }

  formatUser(userId: string, tag?: string | null): string {
    return tag ? `${tag} (\`${userId}\`)` : `<@${userId}> (\`${userId}\`)`;
  }

  formatChannel(channelId: string): string {
    return `<#${channelId}> (\`${channelId}\`)`;
  }

  truncate(text: string | null | undefined, max = 1024): string {
    if (!text) {
      return "*empty*";
    }
    if (text.length <= max) {
      return text;
    }
    return `${text.slice(0, max - 1)}…`;
  }
}
