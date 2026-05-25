import { prisma } from "../../main.js";
import { loggers } from "../logger.js";

/** Minimum extra patrol hours required before re-notifying after a denial. */
export const PROMOTION_RENOTIFY_MIN_EXTRA_HOURS = 1;

export function hasEnoughHoursSinceLastNotification(
  totalHours: number,
  totalHoursAtNotify: number | null | undefined,
): boolean {
  const baseline = totalHoursAtNotify ?? 0;
  return totalHours >= baseline + PROMOTION_RENOTIFY_MIN_EXTRA_HOURS;
}

export type MainVRChatAccountInfo = {
  vrchatUsername: string;
  vrcUserId: string;
};

export async function getMainVRChatAccountInfo(
  discordId: string,
): Promise<MainVRChatAccountInfo | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { discordId },
      include: {
        vrchatAccounts: {
          where: { accountType: "MAIN" },
          take: 1,
        },
      },
    });

    const account = user?.vrchatAccounts?.[0];
    if (!account) {
      return null;
    }

    return {
      vrchatUsername: account.vrchatUsername ?? account.vrcUserId,
      vrcUserId: account.vrcUserId,
    };
  } catch (error) {
    loggers.bot.error(`Failed to get MAIN VRChat account for ${discordId}`, error);
    return null;
  }
}

export function formatPromotionUserLines(
  userId: string,
  userTag: string,
  mainAccount: MainVRChatAccountInfo | null,
): string[] {
  const lines = [
    "**User**",
    `<@${userId}> — ${userTag} (\`${userId}\`)`,
  ];
  if (mainAccount) {
    lines.push(
      `**VRChat (MAIN)**`,
      `[${mainAccount.vrchatUsername}](<https://vrchat.com/home/user/${mainAccount.vrcUserId}>)`,
    );
  } else {
    lines.push("**VRChat (MAIN)**", "_No verified MAIN account linked_");
  }
  return lines;
}
