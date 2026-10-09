import { loggers } from "../../../../utility/logger.js";
import { vrchatUserLogManager } from "../../../../managers/vrchat/vrchatUserLogManager.js";

interface FriendUpdateContent {
  userId?: string;
  user?: unknown;
}

export async function handleFriendUpdate(content: unknown) {
  try {
    const typedContent = content as FriendUpdateContent;
    const { userId, user } = typedContent;

    loggers.bot.debug("[Friend Update] ", { userId, user });

    if (!userId || !user) {
      loggers.vrchat.warn("Missing userId or user data");
      return;
    }

    await vrchatUserLogManager.observeProfile(userId, user);
  } catch (error) {
    loggers.vrchat.error("Error processing friend update", error);
  }
}
