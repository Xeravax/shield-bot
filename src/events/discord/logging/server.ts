import { ArgsOf, Discord, On } from "discordx";
import { AuditLogEvent } from "discord.js";
import {
  auditLogManager,
} from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import { auditExecutorFields } from "../../../managers/logging/index.js";

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
      if (oldGuild.splash !== newGuild.splash) {
        changes.push("Splash changed");
      }
      if (oldGuild.discoverySplash !== newGuild.discoverySplash) {
        changes.push("Discovery splash changed");
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
      if (oldGuild.ownerId !== newGuild.ownerId) {
        changes.push(
          `Owner: <@${oldGuild.ownerId}> → <@${newGuild.ownerId}>`,
        );
      }
      if (oldGuild.afkChannelId !== newGuild.afkChannelId) {
        changes.push(
          `AFK channel: ${oldGuild.afkChannelId ? auditLogManager.formatChannel(oldGuild.afkChannelId) : "*none*"} → ${newGuild.afkChannelId ? auditLogManager.formatChannel(newGuild.afkChannelId) : "*none*"}`,
        );
      }
      if (oldGuild.afkTimeout !== newGuild.afkTimeout) {
        changes.push(
          `AFK timeout: ${oldGuild.afkTimeout}s → ${newGuild.afkTimeout}s`,
        );
      }
      if (oldGuild.systemChannelId !== newGuild.systemChannelId) {
        changes.push(
          `System channel: ${oldGuild.systemChannelId ? auditLogManager.formatChannel(oldGuild.systemChannelId) : "*none*"} → ${newGuild.systemChannelId ? auditLogManager.formatChannel(newGuild.systemChannelId) : "*none*"}`,
        );
      }
      if (oldGuild.rulesChannelId !== newGuild.rulesChannelId) {
        changes.push(
          `Rules channel: ${oldGuild.rulesChannelId ? auditLogManager.formatChannel(oldGuild.rulesChannelId) : "*none*"} → ${newGuild.rulesChannelId ? auditLogManager.formatChannel(newGuild.rulesChannelId) : "*none*"}`,
        );
      }
      if (oldGuild.publicUpdatesChannelId !== newGuild.publicUpdatesChannelId) {
        changes.push(
          `Public updates: ${oldGuild.publicUpdatesChannelId ? auditLogManager.formatChannel(oldGuild.publicUpdatesChannelId) : "*none*"} → ${newGuild.publicUpdatesChannelId ? auditLogManager.formatChannel(newGuild.publicUpdatesChannelId) : "*none*"}`,
        );
      }
      if (oldGuild.preferredLocale !== newGuild.preferredLocale) {
        changes.push(
          `Locale: \`${oldGuild.preferredLocale}\` → \`${newGuild.preferredLocale}\``,
        );
      }
      if (oldGuild.defaultMessageNotifications !== newGuild.defaultMessageNotifications) {
        changes.push(
          `Notifications: ${oldGuild.defaultMessageNotifications} → ${newGuild.defaultMessageNotifications}`,
        );
      }
      if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) {
        changes.push(
          `Content filter: ${oldGuild.explicitContentFilter} → ${newGuild.explicitContentFilter}`,
        );
      }
      if (oldGuild.mfaLevel !== newGuild.mfaLevel) {
        changes.push(`MFA level: ${oldGuild.mfaLevel} → ${newGuild.mfaLevel}`);
      }
      if (oldGuild.nsfwLevel !== newGuild.nsfwLevel) {
        changes.push(`NSFW level: ${oldGuild.nsfwLevel} → ${newGuild.nsfwLevel}`);
      }
      if (oldGuild.premiumProgressBarEnabled !== newGuild.premiumProgressBarEnabled) {
        changes.push(
          `Boost progress bar: ${oldGuild.premiumProgressBarEnabled} → ${newGuild.premiumProgressBarEnabled}`,
        );
      }
      if (oldGuild.widgetEnabled !== newGuild.widgetEnabled) {
        changes.push(
          `Widget enabled: ${oldGuild.widgetEnabled} → ${newGuild.widgetEnabled}`,
        );
      }
      if (oldGuild.widgetChannelId !== newGuild.widgetChannelId) {
        changes.push(
          `Widget channel: ${oldGuild.widgetChannelId ? auditLogManager.formatChannel(oldGuild.widgetChannelId) : "*none*"} → ${newGuild.widgetChannelId ? auditLogManager.formatChannel(newGuild.widgetChannelId) : "*none*"}`,
        );
      }

      const oldFeatures = new Set(oldGuild.features);
      const newFeatures = new Set(newGuild.features);
      const addedFeatures = [...newFeatures].filter((f) => !oldFeatures.has(f));
      const removedFeatures = [...oldFeatures].filter((f) => !newFeatures.has(f));
      if (addedFeatures.length) {
        changes.push(`Features added: ${addedFeatures.join(", ")}`);
      }
      if (removedFeatures.length) {
        changes.push(`Features removed: ${removedFeatures.join(", ")}`);
      }

      if (changes.length === 0) {
        return;
      }

      const { fields: extra, components, entryId } = await auditExecutorFields(
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
          ...extra,
        ],
        components,
        imageUrl:
          oldGuild.splash !== newGuild.splash
            ? newGuild.splashURL({ size: 512 })
            : oldGuild.banner !== newGuild.banner
              ? newGuild.bannerURL({ size: 512 })
              : null,
        auditEntryId: entryId,
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
              ? await auditLogManager.formatUser(invite.inviter.id, invite.inviter.username)
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
}
