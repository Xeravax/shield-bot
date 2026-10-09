import { auditLogManager, prisma } from "../../main.js";
import type { PostLogOptions } from "../logging/auditLogManager.js";
import {
  formatDiscordUserLine,
  formatVrchatProfileLine,
} from "../logging/userDisplay.js";
import { whitelistManager } from "../whitelist/whitelistManager.js";
import { loggers } from "../../utility/logger.js";
import {
  cachedVrchatName,
  diffVrchatProfile,
  formatProfileChange,
  formatProfileValue,
  nameChangeFromCache,
  profileChangeTitle,
  readVrchatProfile,
  type VrchatProfileChange,
  type VrchatProfileSnapshot,
} from "../../utility/vrchat/userProfileDiff.js";

type LogFields = NonNullable<PostLogOptions["fields"]>;

type ObservedRow = {
  displayName: string | null;
  username: string | null;
  pronouns: string | null;
  status: string | null;
  statusDescription: string | null;
};

function snapshotFromRow(row: ObservedRow | null): VrchatProfileSnapshot | null {
  if (!row) {
    return null;
  }
  return {
    displayName: row.displayName,
    username: row.username,
    pronouns: row.pronouns,
    status: row.status,
    statusDescription: row.statusDescription,
  };
}

function thumbnailFrom(user: unknown): string | null {
  if (!user || typeof user !== "object") {
    return null;
  }
  const record = user as Record<string, unknown>;
  for (const key of [
    "currentAvatarThumbnailImageUrl",
    "userIcon",
    "profilePicOverride",
  ]) {
    const value = record[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Persists VRChat friend profile changes and posts them to the
 * VRChat User Logs forum thread. Username rows are written only when the
 * cached name actually changes.
 */
export class VrchatUserLogManager {
  private readonly tails = new Map<string, Promise<void>>();

  async observeProfile(vrcUserId: string, user: unknown): Promise<void> {
    await this.enqueue(vrcUserId, () => this.observeProfileLocked(vrcUserId, user));
  }

  async logFriendship(
    vrcUserId: string,
    action: "added" | "removed",
    user?: unknown,
  ): Promise<void> {
    await this.enqueue(vrcUserId, async () => {
      if (action === "added" && user) {
        try {
          await this.observeProfileLocked(vrcUserId, user);
        } catch (error) {
          loggers.vrchat.warn(
            `Failed to record profile for new friend ${vrcUserId}`,
            error,
          );
        }
      }
      await this.postFriendship(vrcUserId, action, user);
    });
  }

  private enqueue(vrcUserId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.tails.get(vrcUserId) ?? Promise.resolve();
    const run = prev.then(task, task);
    const tracked = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(vrcUserId, tracked);
    void tracked.finally(() => {
      if (this.tails.get(vrcUserId) === tracked) {
        this.tails.delete(vrcUserId);
      }
    });
    return run;
  }

  private async observeProfileLocked(
    vrcUserId: string,
    user: unknown,
  ): Promise<void> {
    const { values, present } = readVrchatProfile(user);
    if (present.size === 0) {
      return;
    }

    const row = await prisma.vRChatObservedProfile.findUnique({
      where: { vrcUserId },
    });
    const previous = snapshotFromRow(row);
    const { isNew, changes, next } = diffVrchatProfile(previous, values, present);
    const cachedName = cachedVrchatName(values);
    const snapshotName = previous?.displayName || previous?.username || null;
    const nameFieldsChanged = changes.some(
      (change) => change.field === "displayName" || change.field === "username",
    );
    const shouldSync =
      cachedName != null &&
      (isNew || nameFieldsChanged || snapshotName !== cachedName);

    const logged: VrchatProfileChange[] = isNew ? [] : [...changes];
    if (shouldSync && cachedName) {
      const sync = await this.syncCachedUsername(vrcUserId, cachedName);
      if (isNew && sync.changed) {
        const nameChange = nameChangeFromCache(sync.previousName, values, present);
        if (nameChange && nameChange.from !== nameChange.to) {
          logged.push(nameChange);
        }
      }
    }

    if (isNew) {
      await prisma.vRChatObservedProfile.create({
        data: {
          vrcUserId,
          displayName: next.displayName,
          username: next.username,
          pronouns: next.pronouns,
          status: next.status,
          statusDescription: next.statusDescription,
        },
      });
    } else if (changes.length > 0) {
      await prisma.vRChatObservedProfile.update({
        where: { vrcUserId },
        data: {
          displayName: next.displayName,
          username: next.username,
          pronouns: next.pronouns,
          status: next.status,
          statusDescription: next.statusDescription,
        },
      });
    }

    if (logged.length === 0) {
      return;
    }

    await this.postToGuilds({
      title: profileChangeTitle(logged),
      severity: "info",
      thumbnailUrl: thumbnailFrom(user),
      fields: [
        ...(await this.identityFields(vrcUserId, next.displayName || cachedName)),
        ...logged.map((change) => ({
          name: change.label,
          value: formatProfileChange(change),
          inline: change.field !== "statusDescription",
        })),
      ],
    });
  }

  private async syncCachedUsername(
    vrcUserId: string,
    currentUsername: string,
  ): Promise<{ changed: boolean; previousName: string | null }> {
    const accounts = await prisma.vRChatAccount.findMany({
      where: { vrcUserId },
      include: { user: { select: { discordId: true } } },
    });
    const stale = accounts.filter(
      (account) => account.vrchatUsername !== currentUsername,
    );
    if (stale.length === 0) {
      return { changed: false, previousName: null };
    }

    const previousName =
      stale.find((account) => account.vrchatUsername)?.vrchatUsername ?? null;

    await prisma.vRChatAccount.updateMany({
      where: { id: { in: stale.map((account) => account.id) } },
      data: {
        vrchatUsername: currentUsername,
        usernameUpdatedAt: new Date(),
      },
    });

    for (const account of stale) {
      const discordId = account.user?.discordId;
      if (!discordId) {
        continue;
      }
      const oldName = account.vrchatUsername || "unknown";
      whitelistManager.queueBatchedUpdate(
        discordId,
        `Username updated: ${oldName} → ${currentUsername}`,
      );
    }

    loggers.vrchat.info(
      `Username changed for ${vrcUserId}: ${previousName ?? "(none)"} → ${currentUsername}`,
    );
    return { changed: true, previousName };
  }

  private async postFriendship(
    vrcUserId: string,
    action: "added" | "removed",
    user: unknown,
  ): Promise<void> {
    const { values } = readVrchatProfile(user);
    const row =
      action === "removed"
        ? await prisma.vRChatObservedProfile.findUnique({ where: { vrcUserId } })
        : null;
    const displayName =
      values.displayName ||
      row?.displayName ||
      values.username ||
      row?.username ||
      null;
    const fields = await this.identityFields(vrcUserId, displayName);
    if (action === "added" && values.status) {
      fields.push({
        name: "Status",
        value: formatProfileValue("status", values.status),
        inline: true,
      });
    }

    await this.postToGuilds({
      title: action === "added" ? "Friend Added" : "Friend Removed",
      severity: action === "added" ? "success" : "warn",
      thumbnailUrl: thumbnailFrom(user),
      fields,
    });
  }

  private async identityFields(
    vrcUserId: string,
    displayName: string | null,
  ): Promise<LogFields> {
    const accounts = await prisma.vRChatAccount.findMany({
      where: { vrcUserId },
      include: { user: { select: { discordId: true } } },
    });
    const preferred =
      accounts.find((account) => account.accountType === "MAIN") ??
      accounts.find((account) => account.accountType === "ALT") ??
      accounts[0];
    const fields: LogFields = [
      {
        name: "User",
        value: formatVrchatProfileLine(
          vrcUserId,
          displayName || preferred?.vrchatUsername,
          preferred?.accountType,
        ),
      },
    ];
    const discordIds = [
      ...new Set(
        accounts
          .map((account) => account.user?.discordId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    if (discordIds.length > 0) {
      fields.push({
        name: "Discord",
        value: discordIds.map((id) => formatDiscordUserLine(id)).join("\n"),
      });
    }
    return fields;
  }

  private async postToGuilds(
    options: Omit<PostLogOptions, "guildId" | "category" | "footer" | "allowedMentions">,
  ): Promise<void> {
    const guilds = await prisma.guildSettings.findMany({
      where: { loggingForumChannelId: { not: null } },
      select: { guildId: true },
    });
    if (guilds.length === 0) {
      loggers.vrchat.debug("No logging forum configured; skipped VRChat user log");
      return;
    }

    await Promise.all(
      guilds.map((guild) =>
        auditLogManager.postLog({
          ...options,
          guildId: guild.guildId,
          category: "vrchatUser",
          footer: "VRChat User Logs",
          allowedMentions: { parse: [] },
        }),
      ),
    );
  }
}

export const vrchatUserLogManager = new VrchatUserLogManager();
