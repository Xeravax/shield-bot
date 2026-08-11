/**
 * Discord-specific configuration constants
 */

import { IntentsBitField, Partials } from "discord.js";

/**
 * Bot intents required for functionality
 */
export const BOT_INTENTS = [
  IntentsBitField.Flags.Guilds,
  IntentsBitField.Flags.GuildMembers,
  IntentsBitField.Flags.GuildVoiceStates,
  IntentsBitField.Flags.GuildScheduledEvents,
  IntentsBitField.Flags.GuildMessages,
  IntentsBitField.Flags.GuildMessageReactions,
  IntentsBitField.Flags.MessageContent,
  IntentsBitField.Flags.GuildModeration,
  IntentsBitField.Flags.GuildEmojisAndStickers,
  IntentsBitField.Flags.GuildInvites,
  IntentsBitField.Flags.GuildWebhooks,
  IntentsBitField.Flags.GuildIntegrations,
  IntentsBitField.Flags.AutoModerationConfiguration,
  IntentsBitField.Flags.AutoModerationExecution,
  IntentsBitField.Flags.GuildExpressions,
] as const;

/**
 * Partials so delete/edit/unban/leave/reactions still resolve when uncached.
 */
export const BOT_PARTIALS = [
  Partials.Channel,
  Partials.Message,
  Partials.GuildMember,
  Partials.User,
  Partials.Reaction,
] as const;

/**
 * Bot configuration
 */
export const BOT_CONFIG = {
  silent: false,
} as const;
