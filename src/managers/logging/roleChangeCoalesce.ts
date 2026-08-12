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

function sortRoles(roles: Role[]): Role[] {
  return [...roles].sort((a, b) => b.position - a.position);
}

function formatRoleLabel(role: Role): string {
  return `${role.name} (\`${role.id}\`)`;
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

/** Name + id only — never <@&id>, which would ping roles in V2 TextDisplay. */
export function formatRoleList(
  roles: Iterable<Role>,
  guildId: string,
): string {
  const list = sortRoles([...roles].filter((r) => r.id !== guildId));
  if (list.length === 0) {
    return "*None*";
  }
  return list.map(formatRoleLabel).join(", ").slice(0, 1024);
}

/** Added/removed roles only, one line each with ➕ / ➖. */
export function formatRoleDiffLines(
  added: Role[],
  removed: Role[],
  unknownRemovedIds: string[] = [],
): string {
  const lines: string[] = [
    ...sortRoles(added).map((r) => `➕ ${formatRoleLabel(r)}`),
    ...sortRoles(removed).map((r) => `➖ ${formatRoleLabel(r)}`),
    ...unknownRemovedIds.map((id) => `➖ Unknown role (\`${id}\`)`),
  ];
  if (lines.length === 0) {
    return "*No role changes*";
  }
  return lines.join("\n").slice(0, 1024);
}

export function diffRolesFromBaseline(
  member: GuildMember,
  baselineRoleIds: Set<string>,
): {
  changesText: string;
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
  const unknownRemovedIds: string[] = [];

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
        unknownRemovedIds.push(id);
      }
    }
  }

  return {
    changesText: formatRoleDiffLines(added, removed, unknownRemovedIds),
    added,
    removed,
    changed:
      added.length > 0 ||
      removed.length > 0 ||
      unknownRemovedIds.length > 0,
  };
}
