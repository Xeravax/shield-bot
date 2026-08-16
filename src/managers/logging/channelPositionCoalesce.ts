export const CHANNEL_POSITION_COALESCE_MS = 2_000;

type FlushHandler = (guildId: string, channelIds: string[]) => Promise<void>;

type PendingReorder = {
  guildId: string;
  channelIds: Set<string>;
  onFlush: FlushHandler;
  timer: NodeJS.Timeout;
};

const pending = new Map<string, PendingReorder>();

/**
 * Batch rapid channel position updates (Discord fires channelUpdate for every
 * sibling that shifted) into one flush after CHANNEL_POSITION_COALESCE_MS of quiet.
 */
export function queueChannelPositionChange(
  guildId: string,
  channelId: string,
  onFlush: FlushHandler,
): void {
  const existing = pending.get(guildId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.channelIds.add(channelId);
    existing.onFlush = onFlush;
    existing.timer = setTimeout(() => {
      pending.delete(guildId);
      void existing.onFlush(guildId, [...existing.channelIds]);
    }, CHANNEL_POSITION_COALESCE_MS);
    return;
  }

  const entry: PendingReorder = {
    guildId,
    channelIds: new Set([channelId]),
    onFlush,
    timer: setTimeout(() => {
      pending.delete(guildId);
      void entry.onFlush(guildId, [...entry.channelIds]);
    }, CHANNEL_POSITION_COALESCE_MS),
  };
  pending.set(guildId, entry);
}
