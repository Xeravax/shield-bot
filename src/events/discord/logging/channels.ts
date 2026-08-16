import { ArgsOf, Discord, On } from "discordx";
import {
  AuditLogEvent,
  ChannelType,
  GuildChannel,
  OverwriteType,
  PermissionOverwrites,
  ThreadChannel,
} from "discord.js";
import { auditLogManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import {
  auditExecutorFields,
  queueChannelPositionChange,
} from "../../../managers/logging/index.js";

function channelLabel(channel: { id: string; name?: string; type: ChannelType }): string {
  const name = "name" in channel && channel.name ? `#${channel.name}` : channel.id;
  return `${name} (\`${channel.id}\`) · type ${ChannelType[channel.type] ?? channel.type}`;
}

function overwriteTargetLabel(
  overwrite: PermissionOverwrites,
  guildId: string,
): string {
  if (overwrite.type === OverwriteType.Role) {
    return overwrite.id === guildId
      ? `@everyone (\`${overwrite.id}\`)`
      : `<@&${overwrite.id}> (\`${overwrite.id}\`)`;
  }
  return `<@${overwrite.id}> (\`${overwrite.id}\`)`;
}

function formatOverwritePerms(overwrite: PermissionOverwrites): string {
  const allow = overwrite.allow.toArray();
  const deny = overwrite.deny.toArray();
  const parts: string[] = [];
  if (allow.length) {
    parts.push(`allow: ${allow.join(", ")}`);
  }
  if (deny.length) {
    parts.push(`deny: ${deny.join(", ")}`);
  }
  return parts.length ? parts.join(" · ") : "*no grants*";
}

function diffPermissionOverwrites(
  oldChannel: GuildChannel | ThreadChannel | { permissionOverwrites?: { cache: Map<string, PermissionOverwrites> }; guild?: { id: string } },
  newChannel: GuildChannel | ThreadChannel | { permissionOverwrites?: { cache: Map<string, PermissionOverwrites> }; guild: { id: string } },
): string[] {
  if (
    !("permissionOverwrites" in oldChannel) ||
    !("permissionOverwrites" in newChannel) ||
    !oldChannel.permissionOverwrites ||
    !newChannel.permissionOverwrites
  ) {
    return [];
  }

  const guildId = newChannel.guild.id;
  const oldMap = oldChannel.permissionOverwrites.cache;
  const newMap = newChannel.permissionOverwrites.cache;
  const changes: string[] = [];

  for (const [id, nw] of newMap) {
    const ow = oldMap.get(id);
    if (!ow) {
      changes.push(
        `Added ${overwriteTargetLabel(nw, guildId)} - ${formatOverwritePerms(nw)}`,
      );
      continue;
    }
    if (
      ow.allow.bitfield !== nw.allow.bitfield ||
      ow.deny.bitfield !== nw.deny.bitfield
    ) {
      const addedAllow = nw.allow
        .toArray()
        .filter((p) => !ow.allow.has(p));
      const removedAllow = ow.allow
        .toArray()
        .filter((p) => !nw.allow.has(p));
      const addedDeny = nw.deny.toArray().filter((p) => !ow.deny.has(p));
      const removedDeny = ow.deny.toArray().filter((p) => !nw.deny.has(p));
      const bits: string[] = [];
      if (addedAllow.length) {
        bits.push(`+allow ${addedAllow.join(", ")}`);
      }
      if (removedAllow.length) {
        bits.push(`-allow ${removedAllow.join(", ")}`);
      }
      if (addedDeny.length) {
        bits.push(`+deny ${addedDeny.join(", ")}`);
      }
      if (removedDeny.length) {
        bits.push(`-deny ${removedDeny.join(", ")}`);
      }
      changes.push(
        `Updated ${overwriteTargetLabel(nw, guildId)} - ${bits.join("; ") || "changed"}`,
      );
    }
  }

  for (const [id, ow] of oldMap) {
    if (!newMap.has(id)) {
      changes.push(
        `Removed ${overwriteTargetLabel(ow, guildId)} - ${formatOverwritePerms(ow)}`,
      );
    }
  }

  return changes;
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
      const { fields: extra, components, entryId } = await auditExecutorFields(
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
        components,
        auditEntryId: entryId,
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
      const { fields: extra, components, entryId } = await auditExecutorFields(
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
        components,
        auditEntryId: entryId,
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

      const positionChanged =
        "rawPosition" in oldChannel &&
        "rawPosition" in newChannel &&
        oldChannel.rawPosition !== newChannel.rawPosition;
      if (positionChanged) {
        queueChannelPositionChange(
          newChannel.guild.id,
          newChannel.id,
          (guildId, channelIds) => this.flushChannelReorder(guildId, channelIds),
        );
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
      if (
        "rtcRegion" in oldChannel &&
        "rtcRegion" in newChannel &&
        oldChannel.rtcRegion !== newChannel.rtcRegion
      ) {
        changes.push(
          `RTC region: \`${oldChannel.rtcRegion ?? "automatic"}\` → \`${newChannel.rtcRegion ?? "automatic"}\``,
        );
      }
      if (
        "videoQualityMode" in oldChannel &&
        "videoQualityMode" in newChannel &&
        oldChannel.videoQualityMode !== newChannel.videoQualityMode
      ) {
        changes.push(
          `Video quality: ${oldChannel.videoQualityMode} → ${newChannel.videoQualityMode}`,
        );
      }
      if (
        "status" in oldChannel &&
        "status" in newChannel &&
        oldChannel.status !== newChannel.status
      ) {
        changes.push(
          `Voice status: \`${oldChannel.status ?? "none"}\` → \`${newChannel.status ?? "none"}\``,
        );
      }
      if (
        "availableTags" in oldChannel &&
        "availableTags" in newChannel
      ) {
        const serializeTag = (t: {
          id: string;
          name: string;
          moderated: boolean;
          emoji: { id: string | null; name: string | null } | null;
        }) => ({
          id: t.id,
          name: t.name,
          moderated: t.moderated,
          emoji: t.emoji
            ? { id: t.emoji.id, name: t.emoji.name }
            : null,
        });
        const formatTag = (t: {
          id: string;
          name: string;
          moderated: boolean;
          emoji: { id: string | null; name: string | null } | null;
        }) => {
          const emojiPart = t.emoji
            ? ` emoji=${t.emoji.name ?? "none"}/${t.emoji.id ?? "none"}`
            : "";
          return `${t.name} (${t.id}${t.moderated ? ", moderated" : ""}${emojiPart})`;
        };
        const oldTags = JSON.stringify(
          (oldChannel.availableTags ?? []).map(serializeTag),
        );
        const newTags = JSON.stringify(
          (newChannel.availableTags ?? []).map(serializeTag),
        );
        if (oldTags !== newTags) {
          const oldNames = (oldChannel.availableTags ?? [])
            .map(formatTag)
            .join(", ");
          const newNames = (newChannel.availableTags ?? [])
            .map(formatTag)
            .join(", ");
          changes.push(
            `Forum tags: \`${oldNames || "none"}\` → \`${newNames || "none"}\``,
          );
        }
      }
      if (
        "defaultForumLayout" in oldChannel &&
        "defaultForumLayout" in newChannel &&
        oldChannel.defaultForumLayout !== newChannel.defaultForumLayout
      ) {
        changes.push(
          `Forum layout: ${oldChannel.defaultForumLayout} → ${newChannel.defaultForumLayout}`,
        );
      }
      if (
        "defaultSortOrder" in oldChannel &&
        "defaultSortOrder" in newChannel &&
        oldChannel.defaultSortOrder !== newChannel.defaultSortOrder
      ) {
        changes.push(
          `Forum sort: ${oldChannel.defaultSortOrder} → ${newChannel.defaultSortOrder}`,
        );
      }
      if (
        "defaultReactionEmoji" in oldChannel &&
        "defaultReactionEmoji" in newChannel
      ) {
        const oldEmoji =
          oldChannel.defaultReactionEmoji?.id ??
          oldChannel.defaultReactionEmoji?.name ??
          null;
        const newEmoji =
          newChannel.defaultReactionEmoji?.id ??
          newChannel.defaultReactionEmoji?.name ??
          null;
        if (oldEmoji !== newEmoji) {
          changes.push(
            `Default reaction: \`${oldEmoji ?? "none"}\` → \`${newEmoji ?? "none"}\``,
          );
        }
      }

      const overwriteChanges = diffPermissionOverwrites(
        oldChannel as GuildChannel,
        newChannel as GuildChannel,
      );
      changes.push(...overwriteChanges);

      if (changes.length === 0) {
        return;
      }

      const title =
        overwriteChanges.length > 0 &&
        changes.length === overwriteChanges.length
          ? "Channel Permissions Updated"
          : "Channel Updated";

      const { fields: extra, components, entryId } = await auditExecutorFields(
        newChannel.guild,
        overwriteChanges.length > 0
          ? AuditLogEvent.ChannelOverwriteUpdate
          : AuditLogEvent.ChannelUpdate,
        newChannel.id,
      );
      await auditLogManager.postLog({
        guildId: newChannel.guild.id,
        category: "channels",
        title,
        severity: overwriteChanges.length > 0 ? "warn" : "info",
        fields: [
          { name: "Channel", value: channelLabel(newChannel as GuildChannel) },
          { name: "Changes", value: changes.join("\n").slice(0, 1024) },
          ...extra,
        ],
        components,
        sourceChannelId: newChannel.id,
        auditEntryId: entryId,
      });
    } catch (error) {
      loggers.bot.debug("channelUpdate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async flushChannelReorder(
    guildId: string,
    channelIds: string[],
  ): Promise<void> {
    try {
      const count = channelIds.length;
      if (count === 0) {
        return;
      }
      await auditLogManager.postLog({
        guildId,
        category: "channels",
        title: "Channels Reordered",
        severity: "info",
        fields: [
          {
            name: "Channels",
            value:
              count === 1
                ? "1 channel was reordered."
                : `${count} channels were reordered.`,
          },
        ],
      });
    } catch (error) {
      loggers.bot.debug("channel reorder log failed", {
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
      const oldTags = [...(oldThread.appliedTags ?? [])].sort().join(",");
      const newTags = [...(newThread.appliedTags ?? [])].sort().join(",");
      if (oldTags !== newTags) {
        changes.push(
          `Tags: \`${oldTags || "none"}\` → \`${newTags || "none"}\``,
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

  @On({ event: "threadMembersUpdate" })
  async onThreadMembersUpdate([
    added,
    removed,
    thread,
  ]: ArgsOf<"threadMembersUpdate">): Promise<void> {
    try {
      const settings = await auditLogManager.getSettings(thread.guild.id);
      if (settings?.loggingForumChannelId === thread.parentId) {
        return;
      }
      if (added.size === 0 && removed.size === 0) {
        return;
      }
      const fields: { name: string; value: string }[] = [
        { name: "Thread", value: channelLabel(thread) },
      ];
      if (added.size) {
        fields.push({
          name: "Joined",
          value: [...added.keys()]
            .map((id) => `<@${id}>`)
            .join(", ")
            .slice(0, 1024),
        });
      }
      if (removed.size) {
        fields.push({
          name: "Left",
          value: [...removed.keys()]
            .map((id) => `<@${id}>`)
            .join(", ")
            .slice(0, 1024),
        });
      }
      await auditLogManager.postLog({
        guildId: thread.guild.id,
        category: "channels",
        title: "Thread Members Updated",
        severity: "info",
        fields,
      });
    } catch (error) {
      loggers.bot.debug("threadMembersUpdate log failed", {
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

  @On({ event: "stageInstanceUpdate" })
  async onStageUpdate([
    oldStage,
    newStage,
  ]: ArgsOf<"stageInstanceUpdate">): Promise<void> {
    try {
      if (!newStage.guild || !oldStage) {
        return;
      }
      const changes: string[] = [];
      if (oldStage.topic !== newStage.topic) {
        changes.push(
          `Topic: ${auditLogManager.truncate(oldStage.topic)} → ${auditLogManager.truncate(newStage.topic)}`,
        );
      }
      if (oldStage.privacyLevel !== newStage.privacyLevel) {
        changes.push(
          `Privacy: ${oldStage.privacyLevel} → ${newStage.privacyLevel}`,
        );
      }
      if (changes.length === 0) {
        return;
      }
      const { fields: extra, components, entryId } = await auditExecutorFields(
        newStage.guild,
        AuditLogEvent.StageInstanceUpdate,
        newStage.id,
      );
      await auditLogManager.postLog({
        guildId: newStage.guild.id,
        category: "channels",
        title: "Stage Updated",
        severity: "info",
        fields: [
          {
            name: "Channel",
            value: auditLogManager.formatChannel(newStage.channelId),
          },
          { name: "Changes", value: changes.join("\n").slice(0, 1024) },
          ...extra,
        ],
        components,
        auditEntryId: entryId,
      });
    } catch (error) {
      loggers.bot.debug("stageInstanceUpdate log failed", {
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
