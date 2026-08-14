import { prisma } from "../../main.js";
import type { RequireResult } from "../requireResult.js";

const NO_GROUP_MESSAGE =
  "❌ No VRChat group configured for this server. Please set it first using `/group config set-group-id`.";

const NO_MAPPINGS_MESSAGE =
  "❌ No role mappings configured. Please configure role mappings using `/group role map`.";

/**
 * Resolve this guild's configured VRChat group id.
 * Always scoped to `guildId` — never a global `findFirst`.
 */
export async function requireGuildVrcGroupId(
  guildId: string,
): Promise<RequireResult<string>> {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { vrcGroupId: true },
  });

  if (!settings?.vrcGroupId) {
    return { ok: false, message: NO_GROUP_MESSAGE };
  }

  return { ok: true, value: settings.vrcGroupId };
}

/**
 * Assert this guild has at least one Discord ↔ VRChat group role mapping.
 */
export async function requireGroupRoleMappings(
  guildId: string,
): Promise<RequireResult<number>> {
  const count = await prisma.groupRoleMapping.count({
    where: { guildId },
  });

  if (count === 0) {
    return { ok: false, message: NO_MAPPINGS_MESSAGE };
  }

  return { ok: true, value: count };
}
