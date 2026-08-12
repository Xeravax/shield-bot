import { prisma } from "../../../../main.js";
import { loggers } from "../../../../utility/logger.js";

interface GroupLeftContent {
  userId?: string;
}

/**
 * Member left the VRChat group.
 * Join/leave forum audit logs come from the audit poller (with actor when applicable).
 * No Discord embed here — avoids duplicates without actor detail.
 */
export async function handleGroupLeft(content: unknown) {
  loggers.vrchat.debug("Group Left (audit poller owns Discord logs)", { content });
  const typedContent = content as GroupLeftContent;

  const vrcUserId = typedContent.userId;
  if (!vrcUserId) {
    loggers.vrchat.warn("No userId in group-left event content");
    return;
  }

  const vrcAccount = await prisma.vRChatAccount.findFirst({
    where: {
      vrcUserId,
      accountType: { in: ["MAIN", "ALT"] },
    },
    include: { user: true },
  });

  if (!vrcAccount?.user) {
    loggers.vrchat.debug(
      `No verified account found for VRChat user ${vrcUserId} on group leave`,
    );
    return;
  }

  loggers.vrchat.info(
    `Verified user left VRChat group: ${vrcAccount.vrchatUsername || vrcUserId} (Discord ${vrcAccount.user.discordId})`,
  );
}
