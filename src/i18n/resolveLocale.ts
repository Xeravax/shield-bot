import { prisma } from "../main.js";
import {
  DEFAULT_LOCALE,
  isAvailableLocale,
  type DiscordLocale,
} from "./index.js";

export type ResolveLocaleArgs = {
  /** Discord snowflake */
  userId?: string | null;
  guildId?: string | null;
};

/**
 * User preference → guild setting → en-US.
 * Use for DMs and ephemeral replies only.
 * Public channel posts must use {@link PUBLIC_MESSAGE_LOCALE} (always English).
 */
export async function resolveLocale(
  args: ResolveLocaleArgs,
): Promise<DiscordLocale> {
  const { userId, guildId } = args;

  if (userId) {
    const user = await prisma.user.findUnique({
      where: { discordId: userId },
      include: { userPreferences: true },
    });
    const userLocale = user?.userPreferences?.locale;
    if (userLocale && isAvailableLocale(userLocale)) {
      return userLocale;
    }
  }

  if (guildId) {
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId },
      select: { locale: true },
    });
    if (settings?.locale && isAvailableLocale(settings.locale)) {
      return settings.locale;
    }
  }

  return DEFAULT_LOCALE;
}

/**
 * Always English. Use for any message posted to a shared guild channel
 * (LOA requests, promotions, welcomes, staff alerts, etc.).
 */
export const PUBLIC_MESSAGE_LOCALE = DEFAULT_LOCALE;

/**
 * Guild default language for channel/thread *names* and similar guild-owned labels.
 * Not for public message body copy — use {@link PUBLIC_MESSAGE_LOCALE} for that.
 */
export async function resolveGuildLocale(
  guildId: string | null | undefined,
): Promise<DiscordLocale> {
  return resolveLocale({ guildId: guildId ?? null });
}
