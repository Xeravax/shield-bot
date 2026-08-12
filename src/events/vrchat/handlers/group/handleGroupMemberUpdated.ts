import { loggers } from "../../../../utility/logger.js";

/**
 * Group member updated in VRChat.
 * Forum audit embeds for role/membership changes come from the audit log poller
 * (includes actor). This handler is debug-only to avoid duplicate logs.
 */
export async function handleGroupMemberUpdated(content: unknown) {
  loggers.vrchat.debug("Group Member Updated (audit poller owns Discord logs)", {
    content,
  });
}
