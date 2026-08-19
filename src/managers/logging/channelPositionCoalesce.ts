export const CHANNEL_POSITION_COALESCE_MS = 2_000;
const ORPHAN_TTL_MS = 10_000;

type FlushHandler = (
  guildId: string,
  channelIds: string[],
  auditEntryIds: string[],
) => Promise<void>;

type PendingReorder = {
  guildId: string;
  channelIds: Set<string>;
  auditEntryIds: Set<string>;
  onFlush: FlushHandler;
  timer: NodeJS.Timeout;
  flushing: boolean;
};

type OrphanBucket = {
  entryIds: Set<string>;
  expiresAt: number;
};

const pending = new Map<string, PendingReorder>();
const orphans = new Map<string, OrphanBucket>();

function orphanKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

function pruneOrphans(now = Date.now()): void {
  for (const [key, bucket] of orphans) {
    if (bucket.expiresAt <= now) {
      orphans.delete(key);
    }
  }
}

/** True while a channel-reorder flush is queued or in flight. */
export function hasPendingChannelReorder(guildId: string): boolean {
  return pending.has(guildId);
}

/**
 * Attach an audit entry id to an in-flight reorder. Returns true when a
 * pending bucket existed and the id was recorded.
 */
export function attachChannelPositionAuditEntry(
  guildId: string,
  entryId: string,
): boolean {
  const existing = pending.get(guildId);
  if (!existing) {
    return false;
  }
  existing.auditEntryIds.add(entryId);
  return true;
}

/**
 * Remember a ChannelUpdate audit id until that channel starts a reorder coalesce.
 */
export function stashOrphanChannelPositionAuditEntry(
  guildId: string,
  channelId: string,
  entryId: string,
): void {
  pruneOrphans();
  const key = orphanKey(guildId, channelId);
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

function claimOrphanChannelPositionAuditEntries(
  guildId: string,
  channelIds: Iterable<string>,
): Set<string> {
  pruneOrphans();
  const ids = new Set<string>();
  for (const channelId of channelIds) {
    const key = orphanKey(guildId, channelId);
    const bucket = orphans.get(key);
    orphans.delete(key);
    if (!bucket || bucket.expiresAt <= Date.now()) {
      continue;
    }
    for (const id of bucket.entryIds) {
      ids.add(id);
    }
  }
  return ids;
}

async function runFlush(entry: PendingReorder): Promise<void> {
  if (entry.flushing) {
    return;
  }
  entry.flushing = true;
  try {
    await entry.onFlush(entry.guildId, [...entry.channelIds], [
      ...entry.auditEntryIds,
    ]);
  } finally {
    pending.delete(entry.guildId);
  }
}

function scheduleFlush(entry: PendingReorder): NodeJS.Timeout {
  return setTimeout(() => {
    void runFlush(entry);
  }, CHANNEL_POSITION_COALESCE_MS);
}

/**
 * Batch rapid channel position updates (Discord fires channelUpdate for every
 * sibling that shifted) into one flush after CHANNEL_POSITION_COALESCE_MS of quiet.
 */
export function queueChannelPositionChange(
  guildId: string,
  channelId: string,
  onFlush: FlushHandler,
): void {
  const claimed = claimOrphanChannelPositionAuditEntries(guildId, [channelId]);
  const existing = pending.get(guildId);
  if (existing) {
    if (existing.flushing) {
      return;
    }
    clearTimeout(existing.timer);
    existing.channelIds.add(channelId);
    for (const id of claimed) {
      existing.auditEntryIds.add(id);
    }
    existing.onFlush = onFlush;
    existing.timer = scheduleFlush(existing);
    return;
  }

  const entry = {
    guildId,
    channelIds: new Set([channelId]),
    auditEntryIds: claimed,
    onFlush,
    flushing: false,
  } as PendingReorder;
  entry.timer = scheduleFlush(entry);
  pending.set(guildId, entry);
}
