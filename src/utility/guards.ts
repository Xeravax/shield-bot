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
import { hasStoredTimezone } from "./userPreferences.js";
import type { AppGuardData } from "./guardData.js";
import { requireVerifiedAccount, requireVerifiedAccounts } from "./verification/requireVerifiedAccount.js";
import {
  requireGroupRoleMappings,
  requireGuildVrcGroupId,
} from "./group/guildGroupConfig.js";
import { requireAttendanceAutofillConfig } from "./patrol/requirePatrolConfig.js";

async function denyMissingPermissionNode(
  interaction: Interaction,
  label: string,
): Promise<undefined> {
  await respondWithError(interaction, label);
  return undefined;
}

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
  _guardData: AppGuardData,
): Promise<unknown> {
  const guildCheck = await requireGuild(interaction);
  if (!guildCheck) {
    return undefined;
  }
  return next();
}

/**
 * Guard to ensure the user has set a profile timezone (required for event time parsing).
 */
export async function RequireTimezoneGuard(
  interaction: Interaction,
  _client: Client,
  next: Next,
  _guardData: AppGuardData,
): Promise<unknown> {
  if (await hasStoredTimezone(interaction.user.id)) {
    return next();
  }

  return respondWithError(
    interaction,
    "❌ Set your timezone first with `/timezone` (or `/profile settings`) before using event commands.",
  );
}

/**
 * Guard to ensure VRChat is logged in and verified
 */
export async function VRChatLoginGuard(
  interaction: Interaction,
  _client: Client,
  next: Next,
  _guardData: AppGuardData,
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
    _guardData: AppGuardData,
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

    return denyMissingPermissionNode(
      interaction,
      `You don't have permission to use this command. Missing permission node: \`${node}\``,
    );
  };
}

/**
 * Guard factory: require any one of the given permission nodes.
 * Usage: @Guard(PermissionNodeGuardAny("events.command.cancel", "events.manage.approve"))
 */
export function PermissionNodeGuardAny(...nodes: string[]) {
  return async function permissionNodeGuardAny(
    interaction: Interaction,
    _client: Client,
    next: Next,
    _guardData: AppGuardData,
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

    for (const node of nodes) {
      if (await hasNode(member, node)) {
        return next();
      }
    }

    const label =
      nodes.length === 1
        ? `You don't have permission to use this command. Missing permission node: \`${nodes[0]}\``
        : `You don't have permission to use this command. Missing one of: ${nodes.map((n) => `\`${n}\``).join(", ")}`;
    return denyMissingPermissionNode(interaction, label);
  };
}

/**
 * Guard to ensure user is bot owner
 */
export async function BotOwnerGuard(
  interaction: Interaction,
  _client: Client,
  next: Next,
  _guardData: AppGuardData,
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

export type VerifiedAccountGuardOptions = {
  requireMain?: boolean;
  /** Skip the check when this slash option is already provided (e.g. `/vrchat request account`). */
  skipIfOption?: string;
};

function readStringOption(interaction: Interaction, name: string): string | null {
  if (!interaction.isChatInputCommand()) {
    return null;
  }
  const value = interaction.options.getString(name);
  return value && value.trim() ? value : null;
}

/**
 * Guard factory: require a verified MAIN/ALT VRChat account for the invoker.
 * On success, sets `guardData.verifiedAccount` for the command method.
 * When `skipIfOption` is set and that option is present, resolves that vrcUserId
 * only if it belongs to the invoker's verified accounts (no untrusted bypass).
 * Distinct from VRChatLoginGuard, which checks the bot's VRChat session.
 */
export function VerifiedAccountGuard(options: VerifiedAccountGuardOptions = {}) {
  return async function verifiedAccountGuard(
    interaction: Interaction,
    _client: Client,
    next: Next,
    guardData: AppGuardData,
  ): Promise<unknown> {
    if (interaction.isAutocomplete()) {
      return next();
    }

    const optionValue = options.skipIfOption
      ? readStringOption(interaction, options.skipIfOption)
      : null;

    if (optionValue) {
      const accountsResult = await requireVerifiedAccounts(interaction.user.id);
      if (!accountsResult.ok) {
        return respondWithError(
          interaction,
          "❌ You don't have a verified VRChat account. Please verify your account first using `/verify account`.",
        );
      }
      const owned = accountsResult.value.find(
        (account) => account.vrcUserId === optionValue,
      );
      if (!owned) {
        return respondWithError(
          interaction,
          "❌ That VRChat account is not linked to your Discord account.",
        );
      }
      guardData.verifiedAccount = owned;
      return next();
    }

    const result = await requireVerifiedAccount(interaction.user.id, {
      requireMain: options.requireMain,
    });
    if (!result.ok) {
      return respondWithError(interaction, result.message);
    }

    guardData.verifiedAccount = result.value;
    return next();
  };
}

/**
 * Guard: require this guild to have a VRChat group id configured.
 * On success, sets `guardData.vrcGroupId` for the command method.
 */
export async function VrchatGroupConfiguredGuard(
  interaction: Interaction,
  _client: Client,
  next: Next,
  guardData: AppGuardData,
): Promise<unknown> {
  const guildCheck = await requireGuild(interaction);
  if (!guildCheck) {
    return undefined;
  }

  const result = await requireGuildVrcGroupId(guildCheck.guildId);
  if (!result.ok) {
    return respondWithError(interaction, result.message);
  }

  guardData.vrcGroupId = result.value;
  return next();
}

/**
 * Guard: require at least one Discord ↔ VRChat group role mapping for this guild.
 */
export async function VrchatRoleMappingsGuard(
  interaction: Interaction,
  _client: Client,
  next: Next,
  _guardData: AppGuardData,
): Promise<unknown> {
  const guildCheck = await requireGuild(interaction);
  if (!guildCheck) {
    return undefined;
  }

  const result = await requireGroupRoleMappings(guildCheck.guildId);
  if (!result.ok) {
    return respondWithError(interaction, result.message);
  }

  return next();
}

/**
 * Guard: require patrol category + enrolled attendance channels.
 * On success, sets `guardData.autofillConfig` for the command method.
 */
export async function AttendanceAutofillConfigGuard(
  interaction: Interaction,
  _client: Client,
  next: Next,
  guardData: AppGuardData,
): Promise<unknown> {
  const guildCheck = await requireGuild(interaction);
  if (!guildCheck) {
    return undefined;
  }

  const result = await requireAttendanceAutofillConfig(guildCheck.guildId);
  if (!result.ok) {
    return respondWithError(interaction, result.message);
  }

  guardData.autofillConfig = result.value;
  return next();
}
