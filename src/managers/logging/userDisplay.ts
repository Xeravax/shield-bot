import { prisma } from "../../main.js";
import { loggers } from "../../utility/logger.js";

export type VrchatAccountDisplay = {
  vrcUserId: string;
  vrchatUsername: string | null;
  accountType: "MAIN" | "ALT";
};

/** Discord markdown profile link that does not unfurl. */
export function formatVrchatProfileLine(
  vrcUserId: string,
  vrchatUsername?: string | null,
): string {
  const label = vrchatUsername?.trim() || vrcUserId;
  return `[${label}](<https://vrchat.com/home/user/${vrcUserId}>) (\`${vrcUserId}\`)`;
}

export function formatDiscordUserLine(
  discordId: string,
  discordUsername?: string | null,
): string {
  const name = discordUsername?.trim();
  if (name) {
    return `<@${discordId}> [\`${name}\`] (\`${discordId}\`)`;
  }
  return `<@${discordId}> (\`${discordId}\`)`;
}

/**
 * Load verified MAIN + ALT VRChat accounts for a Discord user (MAIN first).
 */
export async function getLinkedVrchatAccounts(
  discordId: string,
): Promise<VrchatAccountDisplay[]> {
  try {
    const user = await prisma.user.findUnique({
      where: { discordId },
      include: {
        vrchatAccounts: {
          where: { accountType: { in: ["MAIN", "ALT"] } },
        },
      },
    });

    const accounts = [...(user?.vrchatAccounts ?? [])];
    accounts.sort((a, b) => {
      if (a.accountType === b.accountType) {
        return 0;
      }
      return a.accountType === "MAIN" ? -1 : 1;
    });

    return accounts.map((a) => ({
      vrcUserId: a.vrcUserId,
      vrchatUsername: a.vrchatUsername,
      accountType: a.accountType as "MAIN" | "ALT",
    }));
  } catch (error) {
    loggers.bot.debug("getLinkedVrchatAccounts failed", {
      discordId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Standard logging identity block:
 * <@id> [`username`] (`id`)
 * [VRChat Name](<profile>) (`usr_…`)
 * …alts on following lines
 */
export async function formatLoggedUser(
  discordId: string,
  discordUsername?: string | null,
): Promise<string> {
  const lines = [formatDiscordUserLine(discordId, discordUsername)];
  const accounts = await getLinkedVrchatAccounts(discordId);
  for (const acc of accounts) {
    lines.push(formatVrchatProfileLine(acc.vrcUserId, acc.vrchatUsername));
  }
  return lines.join("\n").slice(0, 1024);
}
