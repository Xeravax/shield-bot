import { prisma } from "../../main.js";
import type { RequireResult } from "../requireResult.js";

export type VerifiedAccount = {
  id: number;
  userId: number;
  vrcUserId: string;
  vrchatUsername: string | null;
  accountType: "MAIN" | "ALT";
};

const NO_VERIFIED_ACCOUNT_MESSAGE =
  "❌ You don't have a verified VRChat account. Please verify your account first using `/verify account`.";

const NO_MAIN_ACCOUNT_MESSAGE =
  "❌ You need a **verified MAIN** VRChat account linked. Use `/verify account` first.";

const NO_TARGET_VERIFIED_ACCOUNTS_MESSAGE =
  "❌ This member does not have any verified VRChat accounts.";

export type RequireVerifiedAccountOptions = {
  requireMain?: boolean;
};

async function loadVerifiedAccounts(
  discordId: string,
): Promise<VerifiedAccount[]> {
  const user = await prisma.user.findUnique({
    where: { discordId },
    include: {
      vrchatAccounts: {
        where: { accountType: { in: ["MAIN", "ALT"] } },
        orderBy: { id: "asc" },
        select: {
          id: true,
          userId: true,
          vrcUserId: true,
          vrchatUsername: true,
          accountType: true,
        },
      },
    },
  });

  if (!user) {
    return [];
  }

  return user.vrchatAccounts.map((account) => ({
    id: account.id,
    userId: account.userId,
    vrcUserId: account.vrcUserId,
    vrchatUsername: account.vrchatUsername,
    accountType: account.accountType as "MAIN" | "ALT",
  }));
}

function pickPreferredAccount(
  accounts: VerifiedAccount[],
  requireMain: boolean,
): VerifiedAccount | null {
  const mainAccount = accounts.find((account) => account.accountType === "MAIN");
  if (requireMain) {
    return mainAccount ?? null;
  }
  return mainAccount ?? accounts[0] ?? null;
}

/**
 * Resolve a verified MAIN/ALT VRChat account for a Discord user.
 * Prefers MAIN, otherwise the first ALT, unless `requireMain` is set.
 */
export async function requireVerifiedAccount(
  discordId: string,
  options: RequireVerifiedAccountOptions = {},
): Promise<RequireResult<VerifiedAccount>> {
  const requireMain = options.requireMain === true;
  const accounts = await loadVerifiedAccounts(discordId);

  if (accounts.length === 0) {
    return { ok: false, message: NO_VERIFIED_ACCOUNT_MESSAGE };
  }

  const account = pickPreferredAccount(accounts, requireMain);
  if (!account) {
    return { ok: false, message: NO_MAIN_ACCOUNT_MESSAGE };
  }

  return { ok: true, value: account };
}

/**
 * Resolve all verified MAIN/ALT VRChat accounts for a target Discord user.
 * Used by staff commands that sync every linked account.
 */
export async function requireVerifiedAccounts(
  discordId: string,
): Promise<RequireResult<VerifiedAccount[]>> {
  const accounts = await loadVerifiedAccounts(discordId);
  if (accounts.length === 0) {
    return { ok: false, message: NO_TARGET_VERIFIED_ACCOUNTS_MESSAGE };
  }
  return { ok: true, value: accounts };
}
