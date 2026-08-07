import type { Guild } from "discord.js";
import { getMainVRChatAccountInfo } from "../../utility/vrchat/promotionAccountInfo.js";

async function resolveMainVrchatUsername(userId: string): Promise<string | null> {
  const main = await getMainVRChatAccountInfo(userId);
  return main?.vrchatUsername ?? null;
}

async function resolveDiscordDisplayName(
  guild: Guild,
  userId: string,
): Promise<string | null> {
  const cached = guild.members.cache.get(userId);
  if (cached) {
    return cached.displayName || cached.user.username;
  }
  try {
    const member = await guild.members.fetch(userId);
    return member.displayName || member.user.username;
  } catch {
    return null;
  }
}

/**
 * Plain display name for Discord Events tab, calendar feeds, and VRChat sync.
 * Prefers MAIN VRChat username; falls back to Discord display name.
 */
export async function resolveEventMemberDisplayName(
  guild: Guild,
  userId: string,
): Promise<string> {
  const vrchatUsername = await resolveMainVrchatUsername(userId);
  if (vrchatUsername) {
    return vrchatUsername;
  }
  return (await resolveDiscordDisplayName(guild, userId)) ?? "Unknown";
}

/** Discord message mention — always use a ping, even if the member left. */
export function formatEventUserMention(userId: string): string {
  return `<@${userId}>`;
}
