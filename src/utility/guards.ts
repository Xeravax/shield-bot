import {
  Interaction,
  BaseInteraction,
  Client,
  GuildMember,
} from "discord.js";
import { Next } from "koa";
import { respondWithError } from "./generalUtils.js";
import { isLoggedInAndVerified } from "./vrchat.js";
import { getEnv } from "../config/env.js";
import { loggers } from "./logger.js";
import { hasNode } from "./permissionNodes.js";

/**
 * Helper function to check if interaction is in a guild
 */
async function requireGuild(
  interaction: Interaction,
): Promise<{ guildId: string; guild: NonNullable<Interaction["guild"]> } | null> {
  if (!interaction.guildId || !interaction.guild) {
    await respondWithError(
      interaction,
      "This command can only be used in a server.",
    );
    return null;
  }
  return { guildId: interaction.guildId, guild: interaction.guild };
}

/**
 * Guard to ensure command is run in a guild context
 */
export async function GuildGuard(
  interaction: Interaction,
  _client: Client,
  next: Next,
): Promise<unknown> {
  const guildCheck = await requireGuild(interaction);
  if (!guildCheck) {
    return undefined;
  }
  return next();
}

/**
 * Guard to ensure VRChat is logged in and verified
 */
export async function VRChatLoginGuard(
  interaction: Interaction,
  _client: Client,
  next: Next,
): Promise<unknown> {
  if (await isLoggedInAndVerified()) {
    return next();
  }

  return respondWithError(
    interaction,
    "Please inform staff of the following error: `VRChat is not logged in or otp verified`",
  );
}

/**
 * Resolve a full GuildMember for permission checks.
 * Fetches from guild API when interaction.member is partial or missing role cache.
 */
export async function resolveGuildMember(
  interaction: BaseInteraction,
): Promise<GuildMember | null> {
  if (!interaction.guild) {
    return null;
  }

  const member = interaction.member;
  if (member instanceof GuildMember && member.roles.cache.size > 0) {
    return member;
  }

  const memberId = interaction.user?.id;
  if (!memberId) {
    return null;
  }

  return interaction.guild.members.fetch(memberId).catch(() => null);
}

/**
 * Guard factory: require the given permission node.
 * Usage: @Guard(PermissionNodeGuard("events.command.schedule"))
 */
export function PermissionNodeGuard(node: string) {
  return async function permissionNodeGuard(
    interaction: Interaction,
    _client: Client,
    next: Next,
  ): Promise<unknown> {
    if (!interaction.guildId || !interaction.guild) {
      await respondWithError(
        interaction,
        "This command can only be used in a server.",
      );
      return undefined;
    }

    const member = await resolveGuildMember(interaction);
    if (!member) {
      await respondWithError(
        interaction,
        "Unable to verify your permissions.",
      );
      return undefined;
    }

    if (await hasNode(member, node)) {
      return next();
    }

    await respondWithError(
      interaction,
      `You don't have permission to use this command. Missing permission node: \`${node}\``,
    );
    return undefined;
  };
}

/**
 * Guard to ensure user is bot owner
 */
export async function BotOwnerGuard(
  interaction: Interaction,
  _client: Client,
  next: Next,
): Promise<unknown> {
  const env = getEnv();
  const botOwnerId = env.BOT_OWNER_ID;

  if (!botOwnerId) {
    loggers.bot.error("BOT_OWNER_ID environment variable is not set!");
    return respondWithError(
      interaction,
      "Bot configuration error. Please contact an administrator.",
    );
  }

  if (interaction.user.id === botOwnerId) {
    return next();
  }

  return respondWithError(
    interaction,
    "This command is restricted to the bot owner.",
  );
}
