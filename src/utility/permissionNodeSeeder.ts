import { prisma } from "../main.js";
import { invalidatePermissionNodeCache } from "./permissionNodes.js";
import { loggers } from "./logger.js";

/** Basic member-facing command nodes (shield member tier). */
const SHIELD_MEMBER_NODES = [
  "patrol.tracked",
  "loa.command.request",
  "vrchat.command.request",
] as const;

/** Trainer tier: member basics (trainer flag had no dedicated guarded commands). */
const TRAINER_NODES = [...SHIELD_MEMBER_NODES] as const;

/** Dev guard tier — matches old DEV_GUARD bitmask areas, excluding staff-only `*`. */
const DEV_GUARD_NODES = [
  "attendance.*",
  "patrol.*",
  "whitelist.*",
  "verification.*",
  "settings.*",
  "loa.*",
  "vrchat.*",
  "rooftop.*",
  "phantomcompiler.*",
  "user.*",
] as const;

const HOST_ATTENDANCE_NODES = ["attendance.*"] as const;
const STAFF_NODES = ["*"] as const;

function parseRoleIds(value: unknown): string[] {
  if (!value || !Array.isArray(value)) {
    return [];
  }
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

async function grantNodes(
  guildId: string,
  roleIds: string[],
  nodes: readonly string[],
): Promise<number> {
  if (roleIds.length === 0 || nodes.length === 0) {
    return 0;
  }

  const data = roleIds.flatMap((roleId) =>
    nodes.map((node) => ({ guildId, roleId, node })),
  );

  const result = await prisma.rolePermission.createMany({
    data,
    skipDuplicates: true,
  });

  return result.count;
}

/**
 * One-time migration: convert legacy GuildSettings role arrays into
 * RolePermission wildcard grants. Idempotent — skips guilds that already
 * have any RolePermission rows.
 */
export async function seedPermissionNodesFromLegacyRoles(): Promise<void> {
  const settingsRows = await prisma.guildSettings.findMany({
    select: {
      guildId: true,
      staffRoleIds: true,
      devGuardRoleIds: true,
      trainerRoleIds: true,
      hostAttendanceRoleIds: true,
      shieldMemberRoleIds: true,
    },
  });

  let seededGuilds = 0;
  let totalGrants = 0;

  const seededGuildIds = new Set(
    (await prisma.rolePermission.groupBy({ by: ["guildId"] })).map((g) => g.guildId),
  );

  for (const settings of settingsRows) {
    if (seededGuildIds.has(settings.guildId)) {
      continue;
    }

    let guildGrants = 0;
    guildGrants += await grantNodes(
      settings.guildId,
      parseRoleIds(settings.staffRoleIds),
      STAFF_NODES,
    );
    guildGrants += await grantNodes(
      settings.guildId,
      parseRoleIds(settings.devGuardRoleIds),
      DEV_GUARD_NODES,
    );
    guildGrants += await grantNodes(
      settings.guildId,
      parseRoleIds(settings.trainerRoleIds),
      TRAINER_NODES,
    );
    guildGrants += await grantNodes(
      settings.guildId,
      parseRoleIds(settings.hostAttendanceRoleIds),
      HOST_ATTENDANCE_NODES,
    );
    guildGrants += await grantNodes(
      settings.guildId,
      parseRoleIds(settings.shieldMemberRoleIds),
      SHIELD_MEMBER_NODES,
    );

    if (guildGrants > 0) {
      invalidatePermissionNodeCache(settings.guildId);
      seededGuilds++;
      totalGrants += guildGrants;
    }
  }

  if (seededGuilds > 0) {
    loggers.bot.info(
      `Permission node seeder: migrated ${totalGrants} grants across ${seededGuilds} guild(s)`,
    );
  }
}
