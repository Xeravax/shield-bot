import { ArgsOf, Discord, On } from "discordx";
import { auditLogManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

function emojiLabel(emoji: {
  id: string | null;
  name: string | null;
  animated?: boolean | null;
}): string {
  if (emoji.id) {
    const name = emoji.name ?? "emoji";
    return emoji.animated ? `<a:${name}:${emoji.id}>` : `<:${name}:${emoji.id}>`;
  }
  return emoji.name ?? "*unknown*";
}

@Discord()
export class LoggingReactionEvents {
  @On({ event: "messageReactionAdd" })
  async onAdd([reaction, user]: ArgsOf<"messageReactionAdd">): Promise<void> {
    try {
      if (user.bot) {
        return;
      }
      if (reaction.partial) {
        await reaction.fetch().catch(() => undefined);
      }
      const message = reaction.message;
      if (!message.guildId) {
        return;
      }
      if (await auditLogManager.shouldIgnoreChannel(message.guildId, message.channelId)) {
        return;
      }

      await auditLogManager.postLog({
        guildId: message.guildId,
        category: "reactions",
        title: "Reaction Added",
        severity: "info",
        fields: [
          {
            name: "User",
            value: auditLogManager.formatUser(user.id, user.tag),
            inline: true,
          },
          {
            name: "Emoji",
            value: emojiLabel(reaction.emoji),
            inline: true,
          },
          {
            name: "Channel",
            value: auditLogManager.formatChannel(message.channelId),
            inline: true,
          },
          {
            name: "Message",
            value: message.url
              ? `[Jump](${message.url})`
              : `\`${message.id}\``,
          },
        ],
        sourceChannelId: message.channelId,
        footer: `Message ID ${message.id}`,
      });
    } catch (error) {
      loggers.bot.debug("messageReactionAdd log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "messageReactionRemove" })
  async onRemove([reaction, user]: ArgsOf<"messageReactionRemove">): Promise<void> {
    try {
      if (user.bot) {
        return;
      }
      if (reaction.partial) {
        await reaction.fetch().catch(() => undefined);
      }
      const message = reaction.message;
      if (!message.guildId) {
        return;
      }
      if (await auditLogManager.shouldIgnoreChannel(message.guildId, message.channelId)) {
        return;
      }

      await auditLogManager.postLog({
        guildId: message.guildId,
        category: "reactions",
        title: "Reaction Removed",
        severity: "warn",
        fields: [
          {
            name: "User",
            value: auditLogManager.formatUser(user.id, user.tag),
            inline: true,
          },
          {
            name: "Emoji",
            value: emojiLabel(reaction.emoji),
            inline: true,
          },
          {
            name: "Channel",
            value: auditLogManager.formatChannel(message.channelId),
            inline: true,
          },
          {
            name: "Message",
            value: message.url
              ? `[Jump](${message.url})`
              : `\`${message.id}\``,
          },
        ],
        sourceChannelId: message.channelId,
        footer: `Message ID ${message.id}`,
      });
    } catch (error) {
      loggers.bot.debug("messageReactionRemove log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "messageReactionRemoveAll" })
  async onRemoveAll([
    message,
  ]: ArgsOf<"messageReactionRemoveAll">): Promise<void> {
    try {
      if (!message.guildId) {
        return;
      }
      if (await auditLogManager.shouldIgnoreChannel(message.guildId, message.channelId)) {
        return;
      }

      await auditLogManager.postLog({
        guildId: message.guildId,
        category: "reactions",
        title: "All Reactions Cleared",
        severity: "danger",
        fields: [
          {
            name: "Channel",
            value: auditLogManager.formatChannel(message.channelId),
          },
          {
            name: "Message",
            value: message.url
              ? `[Jump](${message.url})`
              : `\`${message.id}\``,
          },
        ],
        sourceChannelId: message.channelId,
        footer: `Message ID ${message.id}`,
      });
    } catch (error) {
      loggers.bot.debug("messageReactionRemoveAll log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "messageReactionRemoveEmoji" })
  async onRemoveEmoji([
    reaction,
  ]: ArgsOf<"messageReactionRemoveEmoji">): Promise<void> {
    try {
      if (reaction.partial) {
        await reaction.fetch().catch(() => undefined);
      }
      const message = reaction.message;
      if (!message.guildId) {
        return;
      }
      if (await auditLogManager.shouldIgnoreChannel(message.guildId, message.channelId)) {
        return;
      }

      await auditLogManager.postLog({
        guildId: message.guildId,
        category: "reactions",
        title: "Emoji Reactions Cleared",
        severity: "warn",
        fields: [
          {
            name: "Emoji",
            value: emojiLabel(reaction.emoji),
            inline: true,
          },
          {
            name: "Channel",
            value: auditLogManager.formatChannel(message.channelId),
            inline: true,
          },
          {
            name: "Message",
            value: message.url
              ? `[Jump](${message.url})`
              : `\`${message.id}\``,
          },
        ],
        sourceChannelId: message.channelId,
        footer: `Message ID ${message.id}`,
      });
    } catch (error) {
      loggers.bot.debug("messageReactionRemoveEmoji log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
