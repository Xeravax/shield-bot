import { ArgsOf, Discord, On } from "discordx";
import {
  AttachmentBuilder,
  AuditLogEvent,
  Message,
} from "discord.js";
import {
  auditLogManager,
  bot,
  discordAuditResolver,
  messageArchiveManager,
  modCaseManager,
  prisma,
} from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import type { InviteFilterAction } from "../../../managers/logging/index.js";

const INVITE_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-zA-Z0-9-]+/i;

async function handleInviteFilter(message: Message): Promise<boolean> {
  if (!message.guildId || !message.guild || message.author.bot) {
    return false;
  }
  if (!INVITE_REGEX.test(message.content)) {
    return false;
  }

  const settings = await prisma.guildSettings.findUnique({
    where: { guildId: message.guildId },
    select: {
      inviteFilterEnabled: true,
      inviteFilterAction: true,
      loggingForumChannelId: true,
    },
  });
  if (!settings?.inviteFilterEnabled) {
    return false;
  }

  if (
    settings.loggingForumChannelId &&
    message.channelId === settings.loggingForumChannelId
  ) {
    return false;
  }

  const action = (settings.inviteFilterAction ?? "log") as InviteFilterAction;

  if (action === "delete" || action === "delete_timeout") {
    await message.delete().catch(() => undefined);
  }
  if (action === "delete_timeout" && message.member?.moderatable) {
    await message.member
      .timeout(10 * 60 * 1000, "Invite filter")
      .catch(() => undefined);
  }

  await modCaseManager.createCase({
    guildId: message.guildId,
    type: "FILTER",
    targetId: message.author.id,
    moderatorId: bot.user?.id ?? message.author.id,
    reason: `Invite link detected in <#${message.channelId}>`,
    extraFields: [
      {
        name: "Content",
        value: auditLogManager.truncate(message.content),
      },
      { name: "Action", value: action, inline: true },
    ],
  });

  return true;
}

@Discord()
export class LoggingMessageEvents {
  @On({ event: "messageCreate" })
  async onCreate([message]: ArgsOf<"messageCreate">): Promise<void> {
    try {
      if (!message.guildId || message.author.bot) {
        return;
      }
      if (await auditLogManager.shouldIgnoreChannel(message.guildId, message.channelId)) {
        return;
      }

      await messageArchiveManager.upsertFromMessage(message);
      await handleInviteFilter(message);
    } catch (error) {
      loggers.bot.debug("messageCreate logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "messageUpdate" })
  async onUpdate([oldMessage, newMessage]: ArgsOf<"messageUpdate">): Promise<void> {
    try {
      if (!newMessage.guildId) {
        return;
      }
      if (newMessage.partial) {
        await newMessage.fetch().catch(() => undefined);
      }
      if (!newMessage.author || newMessage.author.bot) {
        return;
      }
      if (await auditLogManager.shouldIgnoreChannel(newMessage.guildId, newMessage.channelId)) {
        return;
      }

      const before =
        (await messageArchiveManager.getByMessageId(newMessage.id))?.content ??
        oldMessage.content ??
        null;
      const after = newMessage.content ?? null;

      if (before === after) {
        // Still refresh cache for attachment/embed changes
        if (newMessage instanceof Message || "content" in newMessage) {
          await messageArchiveManager.upsertFromMessage(newMessage as Message);
        }
        if (
          oldMessage.attachments?.size === newMessage.attachments?.size &&
          oldMessage.embeds?.length === newMessage.embeds?.length
        ) {
          return;
        }
      } else if (newMessage instanceof Message || "content" in newMessage) {
        await messageArchiveManager.upsertFromMessage(newMessage as Message);
      }

      const fields = [
        {
          name: "Author",
          value: auditLogManager.formatUser(
            newMessage.author.id,
            newMessage.author.tag,
          ),
          inline: true,
        },
        {
          name: "Channel",
          value: auditLogManager.formatChannel(newMessage.channelId),
          inline: true,
        },
        {
          name: "Before",
          value: auditLogManager.truncate(before),
        },
        {
          name: "After",
          value: auditLogManager.truncate(after),
        },
        {
          name: "Jump",
          value: `[Go to message](${newMessage.url})`,
        },
      ];

      if ((newMessage.attachments?.size ?? 0) > 0) {
        fields.push({
          name: "Attachments",
          value: [...(newMessage.attachments?.values() ?? [])]
            .map((a) => `[${a.name}](${a.url})`)
            .join("\n")
            .slice(0, 1024),
        });
      }

      await auditLogManager.postLog({
        guildId: newMessage.guildId,
        category: "messages",
        title: "Message Edited",
        severity: "warn",
        fields,
        footer: `Message ID ${newMessage.id}`,
        sourceChannelId: newMessage.channelId,
      });
    } catch (error) {
      loggers.bot.debug("messageUpdate logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "messageDelete" })
  async onDelete([message]: ArgsOf<"messageDelete">): Promise<void> {
    try {
      if (!message.guildId) {
        return;
      }
      if (await auditLogManager.shouldIgnoreChannel(message.guildId, message.channelId)) {
        return;
      }

      const cached =
        (await messageArchiveManager.getByMessageId(message.id)) ??
        (await messageArchiveManager.snapshotFromDiscord(message));

      if (cached?.authorId && (await auditLogManager.shouldIgnoreAuthor(
        message.guildId,
        cached.authorId,
      ))) {
        await messageArchiveManager.deleteCached(message.id);
        return;
      }

      let executorField: string | undefined;
      if (message.guild) {
        const audit = await discordAuditResolver.resolve(
          message.guild,
          AuditLogEvent.MessageDelete,
          { targetId: cached?.authorId, maxAgeMs: 20_000 },
        );
        if (audit.executor) {
          executorField = auditLogManager.formatUser(
            audit.executor.id,
            audit.executor.tag,
          );
        }
      }

      const fields: { name: string; value: string; inline?: boolean }[] = [
        {
          name: "Author",
          value: cached
            ? auditLogManager.formatUser(cached.authorId)
            : "*unknown*",
          inline: true,
        },
        {
          name: "Channel",
          value: auditLogManager.formatChannel(message.channelId),
          inline: true,
        },
      ];
      if (executorField) {
        fields.push({ name: "Executor", value: executorField, inline: true });
      }
      fields.push({
        name: "Content",
        value: auditLogManager.truncate(cached?.content),
      });
      if (cached?.attachments?.length) {
        fields.push({
          name: "Attachments",
          value: cached.attachments
            .map((a) => `[${a.name}](${a.url})`)
            .join("\n")
            .slice(0, 1024),
        });
      }
      if (cached?.stickers?.length) {
        fields.push({
          name: "Stickers",
          value: cached.stickers.map((s) => s.name).join(", "),
        });
      }

      await auditLogManager.postLog({
        guildId: message.guildId,
        category: "messages",
        title: "Message Deleted",
        severity: "danger",
        fields,
        footer: `Message ID ${message.id}`,
        sourceChannelId: message.channelId,
        imageUrl: cached?.attachments?.[0]?.url,
      });

      await messageArchiveManager.deleteCached(message.id);
    } catch (error) {
      loggers.bot.debug("messageDelete logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "messageDeleteBulk" })
  async onDeleteBulk([messages, channel]: ArgsOf<"messageDeleteBulk">): Promise<void> {
    try {
      const guildId = channel.guildId;
      if (!guildId) {
        return;
      }
      if (await auditLogManager.shouldIgnoreChannel(guildId, channel.id)) {
        return;
      }

      const snapshots = [];
      for (const msg of messages.values()) {
        const snap =
          (await messageArchiveManager.getByMessageId(msg.id)) ??
          (await messageArchiveManager.snapshotFromDiscord(msg));
        if (snap) {
          snapshots.push(snap);
        }
      }

      const txt = messageArchiveManager.buildPurgeTxt(channel.id, snapshots);
      await auditLogManager.postLog({
        guildId,
        category: "messages",
        title: "Messages Bulk Deleted",
        severity: "danger",
        fields: [
          {
            name: "Channel",
            value: auditLogManager.formatChannel(channel.id),
            inline: true,
          },
          {
            name: "Count",
            value: String(messages.size),
            inline: true,
          },
          {
            name: "Cached",
            value: String(snapshots.length),
            inline: true,
          },
        ],
        files: [
          new AttachmentBuilder(Buffer.from(txt, "utf8"), {
            name: `bulk-delete-${channel.id}.txt`,
          }),
        ],
        sourceChannelId: channel.id,
      });

      await messageArchiveManager.deleteCachedMany([...messages.keys()]);
    } catch (error) {
      loggers.bot.debug("messageDeleteBulk logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "channelPinsUpdate" })
  async onPinsUpdate([channel, time]: ArgsOf<"channelPinsUpdate">): Promise<void> {
    try {
      if (!("guild" in channel) || !channel.guild) {
        return;
      }
      if (await auditLogManager.shouldIgnoreChannel(channel.guild.id, channel.id)) {
        return;
      }

      await auditLogManager.postLog({
        guildId: channel.guild.id,
        category: "messages",
        title: "Channel Pins Updated",
        severity: "info",
        fields: [
          {
            name: "Channel",
            value: auditLogManager.formatChannel(channel.id),
          },
          {
            name: "Last pin",
            value: time
              ? `<t:${Math.floor(time.getTime() / 1000)}:F>`
              : "*none / unpinned*",
          },
        ],
        sourceChannelId: channel.id,
      });
    } catch (error) {
      loggers.bot.debug("channelPinsUpdate logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
