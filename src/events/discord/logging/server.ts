import { ArgsOf, Discord, On } from "discordx";
import { AuditLogEvent } from "discord.js";
import {
  auditLogManager,
  discordAuditResolver,
} from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

const webhookDebounce = new Map<string, NodeJS.Timeout>();

@Discord()
export class LoggingServerEvents {
  @On({ event: "guildUpdate" })
  async onGuildUpdate([oldGuild, newGuild]: ArgsOf<"guildUpdate">): Promise<void> {
    try {
      const changes: string[] = [];
      if (oldGuild.name !== newGuild.name) {
        changes.push(`Name: \`${oldGuild.name}\` → \`${newGuild.name}\``);
      }
      if (oldGuild.icon !== newGuild.icon) {
        changes.push("Icon changed");
      }
      if (oldGuild.banner !== newGuild.banner) {
        changes.push("Banner changed");
      }
      if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) {
        changes.push(
          `Vanity: \`${oldGuild.vanityURLCode ?? "none"}\` → \`${newGuild.vanityURLCode ?? "none"}\``,
        );
      }
      if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
        changes.push(
          `Verification: ${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`,
        );
      }
      if (oldGuild.description !== newGuild.description) {
        changes.push("Description changed");
      }
      if (changes.length === 0) {
        return;
      }

      const audit = await discordAuditResolver.resolve(
        newGuild,
        AuditLogEvent.GuildUpdate,
      );
      await auditLogManager.postLog({
        guildId: newGuild.id,
        category: "server",
        title: "Server Updated",
        severity: "info",
        fields: [
          { name: "Changes", value: changes.join("\n").slice(0, 1024) },
          ...(audit.executor
            ? [
                {
                  name: "Executor",
                  value: auditLogManager.formatUser(
                    audit.executor.id,
                    audit.executor.tag,
                  ),
                },
              ]
            : []),
        ],
      });
    } catch (error) {
      loggers.bot.debug("guildUpdate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "emojiCreate" })
  async onEmojiCreate([emoji]: ArgsOf<"emojiCreate">): Promise<void> {
    try {
      if (!emoji.guild) {
        return;
      }
      await auditLogManager.postLog({
        guildId: emoji.guild.id,
        category: "server",
        title: "Emoji Created",
        severity: "success",
        fields: [
          { name: "Emoji", value: `:${emoji.name}: (\`${emoji.id}\`)` },
        ],
        thumbnailUrl: emoji.imageURL(),
      });
    } catch (error) {
      loggers.bot.debug("emojiCreate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "emojiDelete" })
  async onEmojiDelete([emoji]: ArgsOf<"emojiDelete">): Promise<void> {
    try {
      if (!emoji.guild) {
        return;
      }
      await auditLogManager.postLog({
        guildId: emoji.guild.id,
        category: "server",
        title: "Emoji Deleted",
        severity: "danger",
        fields: [
          { name: "Emoji", value: `:${emoji.name}: (\`${emoji.id}\`)` },
        ],
      });
    } catch (error) {
      loggers.bot.debug("emojiDelete log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "emojiUpdate" })
  async onEmojiUpdate([oldEmoji, newEmoji]: ArgsOf<"emojiUpdate">): Promise<void> {
    try {
      if (!newEmoji.guild || oldEmoji.name === newEmoji.name) {
        return;
      }
      await auditLogManager.postLog({
        guildId: newEmoji.guild.id,
        category: "server",
        title: "Emoji Updated",
        severity: "info",
        fields: [
          {
            name: "Name",
            value: `:${oldEmoji.name}: → :${newEmoji.name}:`,
          },
        ],
        thumbnailUrl: newEmoji.imageURL(),
      });
    } catch (error) {
      loggers.bot.debug("emojiUpdate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "stickerCreate" })
  async onStickerCreate([sticker]: ArgsOf<"stickerCreate">): Promise<void> {
    try {
      if (!sticker.guildId) {
        return;
      }
      await auditLogManager.postLog({
        guildId: sticker.guildId,
        category: "server",
        title: "Sticker Created",
        severity: "success",
        fields: [
          { name: "Sticker", value: `${sticker.name} (\`${sticker.id}\`)` },
        ],
      });
    } catch (error) {
      loggers.bot.debug("stickerCreate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "stickerDelete" })
  async onStickerDelete([sticker]: ArgsOf<"stickerDelete">): Promise<void> {
    try {
      if (!sticker.guildId) {
        return;
      }
      await auditLogManager.postLog({
        guildId: sticker.guildId,
        category: "server",
        title: "Sticker Deleted",
        severity: "danger",
        fields: [
          { name: "Sticker", value: `${sticker.name} (\`${sticker.id}\`)` },
        ],
      });
    } catch (error) {
      loggers.bot.debug("stickerDelete log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "stickerUpdate" })
  async onStickerUpdate([oldSticker, newSticker]: ArgsOf<"stickerUpdate">): Promise<void> {
    try {
      if (!newSticker.guildId || oldSticker.name === newSticker.name) {
        return;
      }
      await auditLogManager.postLog({
        guildId: newSticker.guildId,
        category: "server",
        title: "Sticker Updated",
        severity: "info",
        fields: [
          {
            name: "Name",
            value: `${oldSticker.name} → ${newSticker.name}`,
          },
        ],
      });
    } catch (error) {
      loggers.bot.debug("stickerUpdate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "inviteCreate" })
  async onInviteCreate([invite]: ArgsOf<"inviteCreate">): Promise<void> {
    try {
      if (!invite.guild) {
        return;
      }
      await auditLogManager.postLog({
        guildId: invite.guild.id,
        category: "server",
        title: "Invite Created",
        severity: "info",
        fields: [
          { name: "Code", value: invite.code, inline: true },
          {
            name: "Channel",
            value: invite.channelId
              ? auditLogManager.formatChannel(invite.channelId)
              : "*unknown*",
            inline: true,
          },
          {
            name: "Inviter",
            value: invite.inviter
              ? auditLogManager.formatUser(invite.inviter.id, invite.inviter.tag)
              : "*unknown*",
          },
          {
            name: "Max uses",
            value: String(invite.maxUses ?? 0),
            inline: true,
          },
        ],
      });
    } catch (error) {
      loggers.bot.debug("inviteCreate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "inviteDelete" })
  async onInviteDelete([invite]: ArgsOf<"inviteDelete">): Promise<void> {
    try {
      if (!invite.guild) {
        return;
      }
      await auditLogManager.postLog({
        guildId: invite.guild.id,
        category: "server",
        title: "Invite Deleted",
        severity: "warn",
        fields: [
          { name: "Code", value: invite.code, inline: true },
          {
            name: "Channel",
            value: invite.channelId
              ? auditLogManager.formatChannel(invite.channelId)
              : "*unknown*",
            inline: true,
          },
        ],
      });
    } catch (error) {
      loggers.bot.debug("inviteDelete log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "webhooksUpdate" })
  async onWebhooksUpdate([channel]: ArgsOf<"webhooksUpdate">): Promise<void> {
    try {
      if (!channel.guild) {
        return;
      }
      const key = channel.guild.id;
      const existing = webhookDebounce.get(key);
      if (existing) {
        clearTimeout(existing);
      }
      webhookDebounce.set(
        key,
        setTimeout(() => {
          webhookDebounce.delete(key);
          void auditLogManager.postLog({
            guildId: channel.guild.id,
            category: "server",
            title: "Webhooks Updated",
            severity: "info",
            fields: [
              {
                name: "Channel",
                value: auditLogManager.formatChannel(channel.id),
              },
            ],
            sourceChannelId: channel.id,
          });
        }, 5_000),
      );
    } catch (error) {
      loggers.bot.debug("webhooksUpdate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
