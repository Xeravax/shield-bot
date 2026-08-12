import { EmbedBuilder, Colors } from "discord.js";
import {
  GroupAuditLogEventType,
  type GroupAudit,
} from "vrc-ts";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma, auditLogManager, loggingSetupManager } from "../../main.js";
import { getGroupAuditLogs } from "../../utility/vrchat/groups.js";
import { VRChatError } from "../../utility/errors.js";
import { loggers } from "../../utility/logger.js";
import { parseLoggingThreadIds } from "../logging/loggingTypes.js";
import { buildStaffActionV2OrNull } from "../logging/reasonPrompt.js";
import {
  formatVrchatProfileLine,
} from "../logging/userDisplay.js";

const PAGE_SIZE = 50;
const MAX_RECENT_IDS = 100;
const MAX_PAGES = 10;

export type VrcGroupAuditCursor = {
  lastSeenCreatedAt: string;
  lastSeenIds: string[];
};

type AuditResult = GroupAudit["results"][number];

function parseCursor(value: unknown): VrcGroupAuditCursor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.lastSeenCreatedAt !== "string") {
    return null;
  }
  const lastSeenIds = Array.isArray(raw.lastSeenIds)
    ? raw.lastSeenIds.filter((id): id is string => typeof id === "string")
    : [];
  return { lastSeenCreatedAt: raw.lastSeenCreatedAt, lastSeenIds };
}

function vrcUserLink(userId: string | null | undefined, displayName?: string | null): string {
  if (!userId) {
    return "_Unknown_";
  }
  return formatVrchatProfileLine(userId, displayName);
}

function eventTitle(eventType: string): string {
  switch (eventType) {
    case GroupAuditLogEventType.Group_Member_Kick:
      return "Member Kicked";
    case GroupAuditLogEventType.Group_Member_Ban:
      return "Member Banned";
    case GroupAuditLogEventType.Group_Member_Unban:
      return "Member Unbanned";
    case GroupAuditLogEventType.Group_Role_Assign:
      return "Role Assigned";
    case GroupAuditLogEventType.Group_Role_Unassign:
      return "Role Removed";
    case GroupAuditLogEventType.Group_Member_Join:
      return "Member Joined";
    case GroupAuditLogEventType.Group_Member_Leave:
      return "Member Left";
    case GroupAuditLogEventType.Group_Member_Update:
      return "Member Updated";
    case GroupAuditLogEventType.Group_Role_Create:
      return "Role Created";
    case GroupAuditLogEventType.Group_Role_Update:
      return "Role Updated";
    case GroupAuditLogEventType.Group_Role_Delete:
      return "Role Deleted";
    case GroupAuditLogEventType.Group_Invite_Create:
      return "Invite Created";
    case GroupAuditLogEventType.Group_Request_Create:
      return "Join Request Created";
    case GroupAuditLogEventType.Group_Request_Deny:
      return "Join Request Denied";
    case GroupAuditLogEventType.Group_Request_Deny_Block:
      return "Join Request Blocked";
    case GroupAuditLogEventType.Group_Announcement_Create:
      return "Post Created";
    case GroupAuditLogEventType.Group_Announcement_Delete:
      return "Post Deleted";
    case GroupAuditLogEventType.Group_Update:
      return "Group Updated";
    case GroupAuditLogEventType.Group_Create:
      return "Group Created";
    case GroupAuditLogEventType.Group_Gallery_Create:
      return "Gallery Created";
    case GroupAuditLogEventType.Group_Gallery_Update:
      return "Gallery Updated";
    case GroupAuditLogEventType.Group_Gallery_Delete:
      return "Gallery Deleted";
    case GroupAuditLogEventType.Group_Instance_Create:
      return "Group Instance Created";
    default:
      return "Group Action";
  }
}

function eventColor(eventType: string): number {
  switch (eventType) {
    case GroupAuditLogEventType.Group_Member_Kick:
    case GroupAuditLogEventType.Group_Member_Ban:
    case GroupAuditLogEventType.Group_Request_Deny_Block:
    case GroupAuditLogEventType.Group_Role_Delete:
      return Colors.Red;
    case GroupAuditLogEventType.Group_Role_Unassign:
    case GroupAuditLogEventType.Group_Member_Leave:
    case GroupAuditLogEventType.Group_Request_Deny:
      return Colors.Orange;
    case GroupAuditLogEventType.Group_Member_Unban:
    case GroupAuditLogEventType.Group_Member_Join:
    case GroupAuditLogEventType.Group_Role_Assign:
    case GroupAuditLogEventType.Group_Role_Create:
      return Colors.Green;
    case GroupAuditLogEventType.Group_Role_Update:
    case GroupAuditLogEventType.Group_Member_Update:
    case GroupAuditLogEventType.Group_Update:
      return Colors.Gold;
    default:
      return Colors.Blurple;
  }
}

function extraDataFields(
  data: AuditResult["data"],
): { name: string; value: string; inline?: boolean }[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  const record = data as Record<string, unknown>;

  if (typeof record.roleName === "string") {
    fields.push({
      name: "Role",
      value: record.roleName,
      inline: true,
    });
  }
  if (typeof record.roleId === "string") {
    fields.push({
      name: "Role ID",
      value: `\`${record.roleId}\``,
      inline: true,
    });
  }
  if (typeof record.title === "string") {
    fields.push({ name: "Title", value: record.title, inline: false });
  }
  if (typeof record.name === "string") {
    fields.push({ name: "Name", value: record.name, inline: true });
  }

  return fields;
}

/**
 * Polls VRChat group audit logs and posts new entries to the VRChat Group forum thread.
 */
export class GroupAuditLogManager {
  private readonly permissionWarnGuilds = new Set<string>();

  async pollAllGuilds(): Promise<void> {
    const guildSettings = await prisma.guildSettings.findMany({
      where: {
        vrcGroupId: { not: null },
        loggingForumChannelId: { not: null },
      },
      select: {
        guildId: true,
        vrcGroupId: true,
        loggingForumChannelId: true,
        loggingThreadIds: true,
        vrcGroupAuditCursor: true,
      },
    });

    for (const settings of guildSettings) {
      if (!settings.vrcGroupId || !settings.loggingForumChannelId) {
        continue;
      }
      try {
        await this.pollGuild(settings);
      } catch (error) {
        loggers.vrchat.error(
          `Group audit poll failed for guild ${settings.guildId}`,
          error,
        );
      }
    }
  }

  private async pollGuild(settings: {
    guildId: string;
    vrcGroupId: string | null;
    loggingForumChannelId: string | null;
    loggingThreadIds: unknown;
    vrcGroupAuditCursor: unknown;
  }): Promise<void> {
    const groupId = settings.vrcGroupId;
    if (!groupId) {
      return;
    }

    const threadIds = parseLoggingThreadIds(settings.loggingThreadIds);
    if (!threadIds.vrchatGroup && settings.loggingForumChannelId) {
      await loggingSetupManager.ensureThreadsForGuild(settings.guildId);
    }

    const cursor = parseCursor(settings.vrcGroupAuditCursor);

    // First run: seed cursor to now — no historic backfill
    if (!cursor) {
      const seeded: VrcGroupAuditCursor = {
        lastSeenCreatedAt: new Date().toISOString(),
        lastSeenIds: [],
      };
      await prisma.guildSettings.update({
        where: { guildId: settings.guildId },
        data: { vrcGroupAuditCursor: seeded as Prisma.InputJsonValue },
      });
      loggers.vrchat.info(
        `Seeded VRChat group audit cursor for guild ${settings.guildId} (no backfill)`,
      );
      return;
    }

    const newEntries: AuditResult[] = [];
    let offset = 0;
    let pages = 0;
    let reachedCursor = false;

    while (pages < MAX_PAGES && !reachedCursor) {
      let page: GroupAudit;
      try {
        page = await getGroupAuditLogs(groupId, {
          n: PAGE_SIZE,
          offset,
        });
      } catch (error) {
        if (
          error instanceof VRChatError &&
          (error.statusCode === 401 ||
            error.statusCode === 403 ||
            error.statusCode === 404)
        ) {
          if (!this.permissionWarnGuilds.has(settings.guildId)) {
            this.permissionWarnGuilds.add(settings.guildId);
            loggers.vrchat.warn(
              `Cannot read group audit logs for guild ${settings.guildId} (group ${groupId}). Bot account needs group-audit-view permission.`,
              { statusCode: error.statusCode, message: error.message },
            );
          }
          return;
        }
        throw error;
      }

      this.permissionWarnGuilds.delete(settings.guildId);

      const results = page.results ?? [];
      if (results.length === 0) {
        break;
      }

      for (const entry of results) {
        const entryTime = Date.parse(entry.created_at);
        const cursorTime = Date.parse(cursor.lastSeenCreatedAt);

        if (
          Number.isFinite(entryTime) &&
          Number.isFinite(cursorTime) &&
          entryTime < cursorTime
        ) {
          reachedCursor = true;
          break;
        }

        if (
          entry.created_at === cursor.lastSeenCreatedAt &&
          cursor.lastSeenIds.includes(entry.id)
        ) {
          reachedCursor = true;
          break;
        }

        if (cursor.lastSeenIds.includes(entry.id)) {
          continue;
        }

        newEntries.push(entry);
      }

      if (reachedCursor || !page.hasNext || results.length < PAGE_SIZE) {
        break;
      }

      offset += PAGE_SIZE;
      pages += 1;
    }

    if (newEntries.length === 0) {
      return;
    }

    // API returns newest-first; process oldest → newest
    newEntries.sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    );

    const processedIds: string[] = [];
    let latestCreatedAt = cursor.lastSeenCreatedAt;

    for (const entry of newEntries) {
      try {
        await this.postEntry(settings.guildId, entry);
        processedIds.push(entry.id);
        if (Date.parse(entry.created_at) >= Date.parse(latestCreatedAt)) {
          latestCreatedAt = entry.created_at;
        }
      } catch (error) {
        loggers.vrchat.error(
          `Failed to post group audit entry ${entry.id} for guild ${settings.guildId}`,
          error,
        );
        // Stop advancing past failed entry so we retry next poll
        break;
      }
    }

    if (processedIds.length === 0) {
      return;
    }

    const idsAtLatest = processedIds.filter((id) => {
      const match = newEntries.find((e) => e.id === id);
      return match?.created_at === latestCreatedAt;
    });

    const preservedIds =
      latestCreatedAt === cursor.lastSeenCreatedAt ? cursor.lastSeenIds : [];

    const nextCursor: VrcGroupAuditCursor = {
      lastSeenCreatedAt: latestCreatedAt,
      lastSeenIds: [...new Set([...preservedIds, ...idsAtLatest, ...processedIds])].slice(
        -MAX_RECENT_IDS,
      ),
    };

    await prisma.guildSettings.update({
      where: { guildId: settings.guildId },
      data: { vrcGroupAuditCursor: nextCursor as Prisma.InputJsonValue },
    });
  }

  private async resolveDiscordUserId(
    vrcUserId: string | null | undefined,
  ): Promise<string | null> {
    if (!vrcUserId) {
      return null;
    }
    const account = await prisma.vRChatAccount.findFirst({
      where: {
        vrcUserId,
        accountType: { in: ["MAIN", "ALT"] },
      },
      include: { user: true },
    });
    return account?.user?.discordId ?? null;
  }

  private shouldPromptActorReason(eventType: string): boolean {
    switch (eventType) {
      case GroupAuditLogEventType.Group_Member_Join:
      case GroupAuditLogEventType.Group_Member_Leave:
      case GroupAuditLogEventType.Group_Instance_Create:
      case GroupAuditLogEventType.Group_Gallery_Create:
      case GroupAuditLogEventType.Group_Gallery_Update:
      case GroupAuditLogEventType.Group_Gallery_Delete:
      case GroupAuditLogEventType.Group_Announcement_Create:
      case GroupAuditLogEventType.Group_Announcement_Delete:
      case GroupAuditLogEventType.Group_Invite_Create:
      case GroupAuditLogEventType.Group_Request_Create:
        return false;
      default:
        return true;
    }
  }

  private async postEntry(guildId: string, entry: AuditResult): Promise<void> {
    const actorDiscordId = await this.resolveDiscordUserId(entry.actorId);
    const targetDiscordId = await this.resolveDiscordUserId(entry.targetId);

    const actorValue = actorDiscordId
      ? await auditLogManager.formatUser(actorDiscordId)
      : vrcUserLink(entry.actorId, entry.actorDisplayName);

    const targetValue = targetDiscordId
      ? await auditLogManager.formatUser(targetDiscordId)
      : entry.targetId
        ? vrcUserLink(entry.targetId)
        : "_None_";

    const fields = [
      { name: "Actor", value: actorValue || "_Unknown_", inline: true },
      { name: "Target", value: targetValue, inline: true },
      {
        name: "Event",
        value: `\`${entry.eventType}\``,
        inline: true,
      },
      ...extraDataFields(entry.data),
    ];

    if (entry.description) {
      fields.push({
        name: "Description",
        value: entry.description.slice(0, 1024),
        inline: false,
      });
    }

    const needsReason =
      !!actorDiscordId && this.shouldPromptActorReason(entry.eventType);

    const v2 = needsReason
      ? await buildStaffActionV2OrNull({
          title: eventTitle(entry.eventType),
          severity:
            entry.eventType === GroupAuditLogEventType.Group_Member_Ban ||
            entry.eventType === GroupAuditLogEventType.Group_Member_Kick
              ? "danger"
              : "warn",
          fields,
          executorId: actorDiscordId,
          reason: null,
        })
      : null;

    if (v2) {
      await auditLogManager.fanOutVrchatGroupLog(guildId, v2);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(eventTitle(entry.eventType))
      .setColor(eventColor(entry.eventType))
      .addFields(fields)
      .setTimestamp(new Date(entry.created_at))
      .setFooter({ text: "S.H.I.E.L.D. Bot - VRChat Group Audit" });

    await auditLogManager.fanOutVrchatGroupLog(guildId, { embeds: [embed] });
  }
}

export const groupAuditLogManager = new GroupAuditLogManager();
