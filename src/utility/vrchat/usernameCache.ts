import { prisma } from "../../main.js";
import { getUserById } from "./user.js";
import { loggers } from "../logger.js";
import { vrchatUserLogManager } from "../../managers/vrchat/vrchatUserLogManager.js";
import { cachedVrchatName, readVrchatProfile } from "./userProfileDiff.js";

/**
 * Refresh the VRChat username cache when it is older than a week.
 * The stored username is rewritten only when the name itself changed.
 */
export async function updateUsernameCache(vrcUserId: string): Promise<void> {
  try {
    // Find the VRChat account
    const vrcAccount = await prisma.vRChatAccount.findFirst({
      where: { vrcUserId },
    });

    if (!vrcAccount) {
      return; // No account found, nothing to update
    }

    // Check if we need to update the username
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const shouldUpdate =
      !vrcAccount.usernameUpdatedAt ||
      vrcAccount.usernameUpdatedAt < oneWeekAgo;

    if (!shouldUpdate) {
      return; // Recently updated, skip
    }

    // Fetch current username from VRChat API
    const userInfo = await getUserById(vrcUserId);
    const currentUsername = cachedVrchatName(readVrchatProfile(userInfo).values);

    if (!currentUsername) {
      loggers.vrchat.warn(
        `Could not fetch username for ${vrcUserId}`,
      );
      return;
    }

    await vrchatUserLogManager.observeProfile(vrcUserId, userInfo);
    await prisma.vRChatAccount.updateMany({
      where: { vrcUserId, vrchatUsername: currentUsername },
      data: { usernameUpdatedAt: new Date() },
    });
  } catch (error) {
    loggers.vrchat.warn(
      `Failed to update username for ${vrcUserId}`,
      error,
    );
  }
}

/**
 * Force update username cache for a user (ignores time restrictions)
 */
export async function forceUpdateUsernameCache(
  vrcUserId: string,
): Promise<void> {
  try {
    const vrcAccount = await prisma.vRChatAccount.findFirst({
      where: { vrcUserId },
    });

    if (!vrcAccount) {
      return;
    }

    const userInfo = await getUserById(vrcUserId);
    const currentUsername = cachedVrchatName(readVrchatProfile(userInfo).values);

    if (currentUsername) {
      await vrchatUserLogManager.observeProfile(vrcUserId, userInfo);
      await prisma.vRChatAccount.updateMany({
        where: { vrcUserId, vrchatUsername: currentUsername },
        data: { usernameUpdatedAt: new Date() },
      });
    }
  } catch (error) {
    loggers.vrchat.warn(
      `Failed to force update username for ${vrcUserId}`,
      error,
    );
  }
}
