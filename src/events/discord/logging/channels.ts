import { ArgsOf, Discord, On } from "discordx";
import {
  AuditLogEvent,
  ChannelType,
  GuildChannel,
  ThreadChannel,
} from "discord.js";
import { auditLogManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import { auditExecutorFields } from "../../../managers/logging/index.js";

function channelLabel(channel: { id: string; name?: string; type: ChannelType }): string {
  const name = "name" in channel && channel.name ? `#${channel.name}` : channel.id;
  return `${name} (\`${channel.id}\`) · type ${ChannelType[channel.type] ?? channel.type}`;
}

@Discord()
export class LoggingChannelEvents {
  @On({ event: "channelCreate" })
  async onCreate([channel]: ArgsOf<"channelCreate">): Promise<void> {
    try {
      if (!("guild" in channel) || !channel.guild) {
        return;
      }
      if (await auditLogManager.shouldIgnoreChannel(channel.guild.id, channel.id)) {
        return;
      }
      const extra = await auditExecutorFields(
        channel.guild,
        AuditLogEvent.ChannelCreate,
        channel.id,
      );
      await auditLogManager.postLog({
        guildId: channel.guild.id,
        category: "channels",
        title: "Channel Created",
        severity: "success",
        fields: [
          { name: "Channel", value: channelLabel(channel) },
          ...extra,
        ],
      });
    } catch (error) {
      loggers.bot.debug("channelCreate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "channelDelete" })
  async onDelete([channel]: ArgsOf<"channelDelete">): Promise<void> {
    try {
      if (!("guild" in channel) || !channel.guild) {
        return;
      }
      if (await auditLogManager.shouldIgnoreChannel(channel.guild.id, channel.id)) {
        return;
      }
      const extra = await auditExecutorFields(
        channel.guild,
        AuditLogEvent.ChannelDelete,
        channel.id,
      );
      await auditLogManager.postLog({
        guildId: channel.guild.id,
        category: "channels",
        title: "Channel Deleted",
        severity: "danger",
        fields: [
          { name: "Channel", value: channelLabel(channel as GuildChannel) },
          ...extra,
        ],
      });
    } catch (error) {
      loggers.bot.debug("channelDelete log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "channelUpdate" })
  async onUpdate([oldChannel, newChannel]: ArgsOf<"channelUpdate">): Promise<void> {
    try {
      if (!("guild" in newChannel) || !newChannel.guild) {
        return;
      }
      if (await auditLogManager.shouldIgnoreChannel(newChannel.guild.id, newChannel.id)) {
        return;
      }

      const changes: string[] = [];
      if ("name" in oldChannel && "name" in newChannel && oldChannel.name !== newChannel.name) {
        changes.push(`Name: \`${oldChannel.name}\` → \`${newChannel.name}\``);
      }
      if (
        "topic" in oldChannel &&
        "topic" in newChannel &&
        oldChannel.topic !== newChannel.topic
      ) {
        changes.push(
          `Topic: ${auditLogManager.truncate(oldChannel.topic)} → ${auditLogManager.truncate(newChannel.topic)}`,
        );
      }
      if (
        "nsfw" in oldChannel &&
        "nsfw" in newChannel &&
        oldChannel.nsfw !== newChannel.nsfw
      ) {
        changes.push(`NSFW: ${oldChannel.nsfw} → ${newChannel.nsfw}`);
      }
      if (
        "rateLimitPerUser" in oldChannel &&
        "rateLimitPerUser" in newChannel &&
        oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser
      ) {
        changes.push(
          `Slowmode: ${oldChannel.rateLimitPerUser}s → ${newChannel.rateLimitPerUser}s`,
        );
      }
      if (
        "bitrate" in oldChannel &&
        "bitrate" in newChannel &&
        oldChannel.bitrate !== newChannel.bitrate
      ) {
        changes.push(`Bitrate: ${oldChannel.bitrate} → ${newChannel.bitrate}`);
      }
      if (
        "userLimit" in oldChannel &&
        "userLimit" in newChannel &&
        oldChannel.userLimit !== newChannel.userLimit
      ) {
        changes.push(`User limit: ${oldChannel.userLimit} → ${newChannel.userLimit}`);
      }
      if (
        "parentId" in oldChannel &&
        "parentId" in newChannel &&
        oldChannel.parentId !== newChannel.parentId
      ) {
        changes.push(
          `Category: ${oldChannel.parentId ?? "none"} → ${newChannel.parentId ?? "none"}`,
        );
      }

      if (changes.length === 0) {
        return;
      }

      const extra = await auditExecutorFields(
        newChannel.guild,
        AuditLogEvent.ChannelUpdate,
        newChannel.id,
      );
      await auditLogManager.postLog({
        guildId: newChannel.guild.id,
        category: "channels",
        title: "Channel Updated",
        severity: "info",
        fields: [
          { name: "Channel", value: channelLabel(newChannel as GuildChannel) },
          { name: "Changes", value: changes.join("\n").slice(0, 1024) },
          ...extra,
        ],
        sourceChannelId: newChannel.id,
      });
    } catch (error) {
      loggers.bot.debug("channelUpdate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "threadCreate" })
  async onThreadCreate([thread]: ArgsOf<"threadCreate">): Promise<void> {
    try {
      const settings = await auditLogManager.getSettings(thread.guild.id);
      if (settings?.loggingForumChannelId === thread.parentId) {
        return;
      }
      await auditLogManager.postLog({
        guildId: thread.guild.id,
        category: "channels",
        title: "Thread Created",
        severity: "success",
        fields: [
          { name: "Thread", value: channelLabel(thread) },
          {
            name: "Parent",
            value: thread.parentId
              ? auditLogManager.formatChannel(thread.parentId)
              : "*none*",
          },
        ],
      });
    } catch (error) {
      loggers.bot.debug("threadCreate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "threadDelete" })
  async onThreadDelete([thread]: ArgsOf<"threadDelete">): Promise<void> {
    try {
      const settings = await auditLogManager.getSettings(thread.guild.id);
      const threadIds = settings?.loggingThreadIds;
      if (
        settings?.loggingForumChannelId === thread.parentId ||
        (threadIds &&
          typeof threadIds === "object" &&
          Object.values(threadIds as Record<string, string>).includes(thread.id))
      ) {
        return;
      }
      await auditLogManager.postLog({
        guildId: thread.guild.id,
        category: "channels",
        title: "Thread Deleted",
        severity: "danger",
        fields: [{ name: "Thread", value: channelLabel(thread as ThreadChannel) }],
      });
    } catch (error) {
      loggers.bot.debug("threadDelete log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "threadUpdate" })
  async onThreadUpdate([oldThread, newThread]: ArgsOf<"threadUpdate">): Promise<void> {
    try {
      const settings = await auditLogManager.getSettings(newThread.guild.id);
      if (settings?.loggingForumChannelId === newThread.parentId) {
        return;
      }
      const changes: string[] = [];
      if (oldThread.name !== newThread.name) {
        changes.push(`Name: \`${oldThread.name}\` → \`${newThread.name}\``);
      }
      if (oldThread.archived !== newThread.archived) {
        changes.push(`Archived: ${oldThread.archived} → ${newThread.archived}`);
      }
      if (oldThread.locked !== newThread.locked) {
        changes.push(`Locked: ${oldThread.locked} → ${newThread.locked}`);
      }
      if (oldThread.rateLimitPerUser !== newThread.rateLimitPerUser) {
        changes.push(
          `Slowmode: ${oldThread.rateLimitPerUser}s → ${newThread.rateLimitPerUser}s`,
        );
      }
      if (changes.length === 0) {
        return;
      }
      await auditLogManager.postLog({
        guildId: newThread.guild.id,
        category: "channels",
        title: "Thread Updated",
        severity: "info",
        fields: [
          { name: "Thread", value: channelLabel(newThread) },
          { name: "Changes", value: changes.join("\n") },
        ],
      });
    } catch (error) {
      loggers.bot.debug("threadUpdate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "stageInstanceCreate" })
  async onStageCreate([stage]: ArgsOf<"stageInstanceCreate">): Promise<void> {
    try {
      if (!stage.guild) {
        return;
      }
      await auditLogManager.postLog({
        guildId: stage.guild.id,
        category: "channels",
        title: "Stage Started",
        severity: "info",
        fields: [
          { name: "Topic", value: stage.topic || "*none*" },
          {
            name: "Channel",
            value: auditLogManager.formatChannel(stage.channelId),
          },
        ],
      });
    } catch (error) {
      loggers.bot.debug("stageInstanceCreate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "stageInstanceDelete" })
  async onStageDelete([stage]: ArgsOf<"stageInstanceDelete">): Promise<void> {
    try {
      if (!stage.guild) {
        return;
      }
      await auditLogManager.postLog({
        guildId: stage.guild.id,
        category: "channels",
        title: "Stage Ended",
        severity: "info",
        fields: [
          { name: "Topic", value: stage.topic || "*none*" },
          {
            name: "Channel",
            value: auditLogManager.formatChannel(stage.channelId),
          },
        ],
      });
    } catch (error) {
      loggers.bot.debug("stageInstanceDelete log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
