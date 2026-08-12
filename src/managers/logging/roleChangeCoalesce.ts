import type { GuildMember, PartialGuildMember, Role } from "discord.js";

export const ROLE_CHANGE_COALESCE_MS = 5_000;

type FlushHandler = (
  guildId: string,
  member: GuildMember,
  baselineRoleIds: Set<string>,
) => Promise<void>;

type PendingRoleChange = {
  guildId: string;
  baselineRoleIds: Set<string>;
  latestMember: GuildMember;
  timer: NodeJS.Timeout;
};

const pending = new Map<string, PendingRoleChange>();

function keyFor(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function roleIdSet(
  member: GuildMember | PartialGuildMember,
): Set<string> {
  return new Set(member.roles.cache.keys());
}

/**
 * Coalesce rapid member role updates (staff often remove then add within a few
 * seconds) into a single flush after ROLE_CHANGE_COALESCE_MS of quiet.
 */
export function queueMemberRoleChange(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
  onFlush: FlushHandler,
): void {
  const guildId = newMember.guild.id;
  const userId = newMember.id;
  const key = keyFor(guildId, userId);
  const existing = pending.get(key);

  if (existing) {
    clearTimeout(existing.timer);
    existing.latestMember = newMember;
    existing.timer = setTimeout(() => {
      pending.delete(key);
      void onFlush(guildId, existing.latestMember, existing.baselineRoleIds);
    }, ROLE_CHANGE_COALESCE_MS);
    return;
  }

  const baselineRoleIds = roleIdSet(oldMember);
  const entry: PendingRoleChange = {
    guildId,
    baselineRoleIds,
    latestMember: newMember,
    timer: setTimeout(() => {
      pending.delete(key);
      void onFlush(guildId, entry.latestMember, entry.baselineRoleIds);
    }, ROLE_CHANGE_COALESCE_MS),
  };
  pending.set(key, entry);
}

export function formatRoleList(
  roles: Iterable<Role>,
  guildId: string,
): string {
  const list = [...roles]
    .filter((r) => r.id !== guildId)
    .sort((a, b) => b.position - a.position);
  if (list.length === 0) {
    return "*None*";
  }
  // Name + id only — Role.toString() is <@&id> and would ping whole staff roles
  // when this text lives in Components V2 TextDisplay.
  return list
    .map((r) => `${r.name} (\`${r.id}\`)`)
    .join(", ")
    .slice(0, 1024);
}

export function diffRolesFromBaseline(
  member: GuildMember,
  baselineRoleIds: Set<string>,
): {
  fromText: string;
  toText: string;
  added: Role[];
  removed: Role[];
  changed: boolean;
} {
  const guildId = member.guild.id;
  const currentIds = new Set(
    [...member.roles.cache.keys()].filter((id) => id !== guildId),
  );
  const baseline = new Set(
    [...baselineRoleIds].filter((id) => id !== guildId),
  );

  const added: Role[] = [];
  const removed: Role[] = [];

  for (const id of currentIds) {
    if (!baseline.has(id)) {
      const role = member.roles.cache.get(id);
      if (role) {
        added.push(role);
      }
    }
  }
  for (const id of baseline) {
    if (!currentIds.has(id)) {
      const role =
        member.guild.roles.cache.get(id) ??
        member.roles.cache.get(id);
      if (role) {
        removed.push(role);
      } else {
        // Role may have been deleted; still note the id
      }
    }
  }

  const fromRoles = [...baseline]
    .map((id) => member.guild.roles.cache.get(id))
    .filter((r): r is Role => !!r);
  const toRoles = [...currentIds]
    .map((id) => member.roles.cache.get(id))
    .filter((r): r is Role => !!r);

  return {
    fromText: formatRoleList(fromRoles, guildId),
    toText: formatRoleList(toRoles, guildId),
    added,
    removed,
    changed: added.length > 0 || removed.length > 0,
  };
}
