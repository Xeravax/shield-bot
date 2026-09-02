import type { GuildMember } from "discord.js";
import {
  hasNode,
  getRoleIdsWithNode,
} from "../permissionNodes.js";
import {
  getResolvedUserPreferences,
  hasStoredTimezone,
} from "../userPreferences.js";
import { ensureGuildMembersFetched } from "../guildMemberCache.js";
import { bot } from "../../main.js";
import { dashboardGuildId, DashboardForbiddenError } from "./auth.js";
import type { DiscordOAuthUser } from "./auth.js";

export type TrainerType = "emt" | "tru" | "cadet";

export interface DashboardSession {
  user: DiscordOAuthUser;
  member: GuildMember | null;
  guildId: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
  timezoneStored: boolean;
  shieldMember: boolean;
  deputy: boolean;
  staff: boolean;
  host: boolean;
  /** Event hosting team lead (`events.manage.approve`) — edit any event */
  hostLead: boolean;
  /** Bypass week/time rules (`events.schedule.force`) */
  canForceSchedule: boolean;
  trainerTypes: TrainerType[];
}

async function countMembersWithNode(
  guildId: string,
  node: string,
): Promise<number> {
  const guild = bot.guilds.cache.get(guildId) ??
    (await bot.guilds.fetch(guildId).catch(() => null));
  if (!guild) {
    return 0;
  }

  const roleIds = await getRoleIdsWithNode(guildId, node);
  if (roleIds.length === 0) {
    return 0;
  }

  try {
    await ensureGuildMembersFetched(guild);
  } catch {
    // fall through with partial cache
  }

  const unique = new Set<string>();
  for (const roleId of roleIds) {
    const role =
      guild.roles.cache.get(roleId) ??
      (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) {
      continue;
    }
    for (const memberId of role.members.keys()) {
      unique.add(memberId);
    }
  }
  return unique.size;
}

export async function buildDashboardSession(
  user: DiscordOAuthUser,
  member: GuildMember | null,
): Promise<DashboardSession> {
  const guildId = dashboardGuildId();
  const prefs = await getResolvedUserPreferences(user.id);
  const timezoneStored = await hasStoredTimezone(user.id);

  const shieldMember = member
    ? await hasNode(member, "patrol.tracked")
    : false;
  const deputy = member ? await hasNode(member, "patrol.avatar") : false;
  const staff = member
    ? await hasNode(member, "dashboard.roles.staff")
    : false;
  const host = member
    ? (await hasNode(member, "dashboard.roles.host")) ||
      (await hasNode(member, "roles.host")) ||
      (await hasNode(member, "roles.jrhost"))
    : false;
  const hostLead = member
    ? await hasNode(member, "events.manage.approve")
    : false;
  const canForceSchedule = member
    ? await hasNode(member, "events.schedule.force")
    : false;

  const trainerTypes: TrainerType[] = [];
  if (member) {
    if (await hasNode(member, "dashboard.roles.trainer.emt")) {
      trainerTypes.push("emt");
    }
    if (await hasNode(member, "dashboard.roles.trainer.tru")) {
      trainerTypes.push("tru");
    }
    if (await hasNode(member, "dashboard.roles.trainer.cadet")) {
      trainerTypes.push("cadet");
    }
  }

  const displayName =
    member?.displayName ??
    user.global_name ??
    user.username;

  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : null;

  return {
    user,
    member,
    guildId,
    displayName,
    avatarUrl,
    timezone: prefs.timezone,
    timezoneStored,
    shieldMember,
    deputy,
    staff,
    host: host || hostLead,
    hostLead,
    canForceSchedule,
    trainerTypes,
  };
}

export function requireShieldMember(session: DashboardSession): void {
  if (!session.shieldMember) {
    throw new DashboardForbiddenError("SHIELD membership required.");
  }
}

export function requireStaff(session: DashboardSession): void {
  if (!session.staff) {
    throw new DashboardForbiddenError("Staff access required.");
  }
}

export function requireHost(session: DashboardSession): void {
  if (!session.host) {
    throw new DashboardForbiddenError("Host access required.");
  }
}

export { countMembersWithNode };
