import type { GuildMember, PartialGuildMember, Role } from "discord.js";

export const ROLE_CHANGE_COALESCE_MS = 5_000;
const ORPHAN_TTL_MS = 10_000;

type FlushHandler = (
  guildId: string,
  member: GuildMember,
  baselineRoleIds: Set<string>,
  auditEntryIds: string[],
) => Promise<void>;

type PendingRoleChange = {
  guildId: string;
  baselineRoleIds: Set<string>;
  latestMember: GuildMember;
  timer: NodeJS.Timeout;
  auditEntryIds: Set<string>;
  flushing: boolean;
  onFlush: FlushHandler;
};

type OrphanBucket = {
  entryIds: Set<string>;
  expiresAt: number;
};

const pending = new Map<string, PendingRoleChange>();
const orphans = new Map<string, OrphanBucket>();

function keyFor(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function pruneOrphans(now = Date.now()): void {
  for (const [key, bucket] of orphans) {
    if (bucket.expiresAt <= now) {
      orphans.delete(key);
    }
  }
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

/** True while a role-change flush is queued or in flight. */
export function hasPendingMemberRoleChange(
  guildId: string,
  userId: string,
): boolean {
  return pending.has(keyFor(guildId, userId));
}

/**
 * Attach an audit entry id to an in-flight coalesce. Returns true when a
 * pending bucket existed and the id was recorded.
 */
export function attachMemberRoleAuditEntry(
  guildId: string,
  userId: string,
  entryId: string,
): boolean {
  const existing = pending.get(keyFor(guildId, userId));
  if (!existing) {
    return false;
  }
  existing.auditEntryIds.add(entryId);
  return true;
}

/**
 * Remember a MemberRoleUpdate audit id until guildMemberUpdate starts coalesce.
 */
export function stashOrphanMemberRoleAuditEntry(
  guildId: string,
  userId: string,
  entryId: string,
): void {
  pruneOrphans();
  const key = keyFor(guildId, userId);
  const existing = orphans.get(key);
  const expiresAt = Date.now() + ORPHAN_TTL_MS;
  if (existing && existing.expiresAt > Date.now()) {
    existing.entryIds.add(entryId);
    existing.expiresAt = expiresAt;
    return;
  }
  orphans.set(key, {
    entryIds: new Set([entryId]),
    expiresAt,
  });
}

function claimOrphanMemberRoleAuditEntries(
  guildId: string,
  userId: string,
): Set<string> {
  pruneOrphans();
  const key = keyFor(guildId, userId);
  const bucket = orphans.get(key);
  orphans.delete(key);
  if (!bucket || bucket.expiresAt <= Date.now()) {
    return new Set();
  }
  return bucket.entryIds;
}

async function runFlush(
  key: string,
  entry: PendingRoleChange,
): Promise<void> {
  if (entry.flushing) {
    return;
  }
  entry.flushing = true;
  try {
    await entry.onFlush(
      entry.guildId,
      entry.latestMember,
      entry.baselineRoleIds,
      [...entry.auditEntryIds],
    );
  } finally {
    pending.delete(key);
  }
}

function scheduleFlush(key: string, entry: PendingRoleChange): NodeJS.Timeout {
  return setTimeout(() => {
    void runFlush(key, entry);
  }, ROLE_CHANGE_COALESCE_MS);
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
    if (existing.flushing) {
      return;
    }
    clearTimeout(existing.timer);
    existing.latestMember = newMember;
    existing.onFlush = onFlush;
    existing.timer = scheduleFlush(key, existing);
    return;
  }

  const entry = {
    guildId,
    baselineRoleIds: roleIdSet(oldMember),
    latestMember: newMember,
    auditEntryIds: claimOrphanMemberRoleAuditEntries(guildId, userId),
    flushing: false,
    onFlush,
  } as PendingRoleChange;
  entry.timer = scheduleFlush(key, entry);
  pending.set(key, entry);
}

/** Name + id only - never <@&id>, which would ping roles in V2 TextDisplay. */
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
