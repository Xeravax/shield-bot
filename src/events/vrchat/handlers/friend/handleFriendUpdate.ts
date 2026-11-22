import { whitelistManager } from "../../../../managers/whitelist/whitelistManager.js";
import { loggers } from "../../../../utility/logger.js";

interface FriendUpdateContent {
  userId?: string;
  user?: {
    displayName?: string;
    username?: string;
  };
}

/**
 * friend-update arrives whenever a friend of the bot account changes their profile,
 * including their display name. Keep the cached name current and republish the
 * whitelist when it changes, since worlds match players by display name.
 */
export async function handleFriendUpdate(content: unknown) {
  try {
    const { userId, user } = content as FriendUpdateContent;

    loggers.bot.debug("[Friend Update] ", { userId, user });

    if (!userId || !user) {
      loggers.vrchat.warn("Missing userId or user data");
      return;
    }

    const currentUsername = user.displayName || user.username;
    if (!currentUsername) {return;}

    try {
      await whitelistManager.applyVrchatDisplayName(userId, currentUsername, "friend-update");
    } catch (error) {
      loggers.vrchat.error(`Error updating username cache for ${userId}`, error);
    }
  } catch (error) {
    loggers.vrchat.error("Error processing friend update", error);
  }
}
