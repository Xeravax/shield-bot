import { loggers } from "../../../../utility/logger.js";
import { vrchatUserLogManager } from "../../../../managers/vrchat/vrchatUserLogManager.js";

/**
 * Handles the friend-delete event.
 * @param content The event content, expected to contain userId.
 */
interface FriendDeleteContent {
  userId?: string;
  user?: unknown;
}

export async function handleFriendDelete(content: unknown) {
  const typedContent = content as FriendDeleteContent;
  if (!typedContent.userId) {
    loggers.vrchat.warn("Missing userId in content", { content });
    return;
  }

  try {
    await vrchatUserLogManager.logFriendship(
      typedContent.userId,
      "removed",
      typedContent.user,
    );
  } catch (error) {
    loggers.vrchat.error(
      `Error logging friend delete for ${typedContent.userId}`,
      error,
    );
  }
}
