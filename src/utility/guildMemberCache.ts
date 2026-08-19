import type { Guild } from "discord.js";

const CACHE_RATIO = 0.9;
const inFlight = new Map<string, Promise<void>>();

export function isGuildMemberCacheWarm(guild: Guild): boolean {
  return guild.members.cache.size >= guild.memberCount * CACHE_RATIO;
}

/**
 * Populate `guild.members` via a single in-flight Request Guild Members
 * per guild so concurrent callers (server stats, promotions, role tracking)
 * share one gateway opcode 8 instead of racing into GatewayRateLimitError.
 */
export async function ensureGuildMembersFetched(guild: Guild): Promise<void> {
  if (isGuildMemberCacheWarm(guild)) {
    return;
  }

  const existing = inFlight.get(guild.id);
  if (existing) {
    await existing;
    return;
  }

  const pending = guild.members
    .fetch()
    .then(() => undefined)
    .finally(() => {
      inFlight.delete(guild.id);
    });
  inFlight.set(guild.id, pending);
  await pending;
}
