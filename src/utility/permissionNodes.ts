import {
  GuildMember,
  PermissionFlagsBits,
} from "discord.js";
import { prisma } from "../main.js";
import { getEnv } from "../config/env.js";
import { loggers } from "./logger.js";
export {
  PermissionNodeGuard,
  PermissionNodeGuardAny,
  resolveGuildMember,
} from "./guards.js";

/** Slash-command nodes granted to roles marked as event Host / Jr. Host. */
export const EVENT_HOST_COMMAND_NODES = [
  "events.command.schedule",
  "events.command.edit",
  "events.command.submit",
  "events.command.cancel",
] as const;

/**
 * Granular permission node system.
 *
 * Nodes are strings like "events.command.schedule" or "patrol.manage.wipe",
 * granted to Discord roles via the RolePermission table (managed with
 * /permissions grant|revoke|list). Grants support wildcards:
 *   "*"                -> everything
 *   "events.*"         -> every node in the events area
 *   "events.command.*" -> every events slash command node
 *
 * Discord Administrator permission and the BOT_OWNER_ID env always pass.
 */

export interface PermissionNodeDefinition {
  node: string;
  description: string;
}

/**
 * Central registry of all known permission nodes, organized per feature area.
 * Used for /permissions autocomplete, validation, and documentation.
 * Convention: <area>.command.<name> for slash commands,
 * <area>.manage.<action> for button/approval/inline-check actions.
 */
export const PERMISSION_NODE_REGISTRY: Record<
  string,
  PermissionNodeDefinition[]
> = {
  patrol: [
    { node: "patrol.command.current", description: "/patrol current — show tracked users in voice" },
    { node: "patrol.command.top", description: "/patrol top — patrol time leaderboard" },
    { node: "patrol.command.manage", description: "/patrol manage — manage patrol time (add/remove/wipe)" },
    { node: "patrol.command.time", description: "/patrol time — check patrol time (shield members)" },
    { node: "patrol.manage.view-others", description: "View other members' patrol time and sessions" },
    { node: "patrol.manage.wipe", description: "Confirm patrol wipe actions (buttons)" },
    { node: "patrol.manage.promotion", description: "Approve/deny patrol promotion suggestions (buttons)" },
    { node: "patrol.manage.session-remove", description: "Remove individual patrol sessions (buttons)" },
    { node: "patrol.tracked", description: "Member is eligible for patrol voice time tracking" },
  ],
  loa: [
    { node: "loa.command.request", description: "/loa request — request a leave of absence" },
    { node: "loa.command.remove-cooldown", description: "/loa remove-cooldown — remove a member's LOA cooldown" },
    { node: "loa.manage.approve", description: "Approve/deny LOA requests (buttons)" },
  ],
  attendance: [
    { node: "attendance.command.event", description: "/attendance event — start/stop attendance events" },
    { node: "attendance.command.autofill", description: "/attendance autofill — autofill attendance from voice" },
    { node: "attendance.command.member", description: "/attendance member — manage attendance members" },
    { node: "attendance.command.paste", description: "/attendance paste — paste attendance data" },
    { node: "attendance.command.role", description: "/attendance role — attendance role operations" },
    { node: "attendance.command.status", description: "/attendance status — show attendance status" },
    { node: "attendance.manage.staff-host", description: "Act as staff host for attendance (autofill host checks)" },
  ],
  settings: [
    { node: "settings.command.attendance", description: "/settings attendance — attendance channel settings" },
    { node: "settings.command.events", description: "/settings events — event scheduling and reminder settings" },
    { node: "settings.command.group", description: "/settings group — VRChat group settings" },
    { node: "settings.command.loa", description: "/settings loa — LOA settings" },
    { node: "settings.command.patrol", description: "/settings patrol — patrol channel/category settings" },
    { node: "settings.command.promotion", description: "/settings patrol promotion — promotion rules and channels" },
    { node: "settings.command.role-tracking", description: "/settings role-tracking — role tracking configuration" },
    { node: "settings.command.roles", description: "/settings roles — legacy permission role management" },
    { node: "settings.command.vrchat", description: "/settings vrchat — VRChat world settings" },
    { node: "settings.command.whitelist", description: "/settings whitelist — whitelist GitHub settings" },
  ],
  whitelist: [
    { node: "whitelist.command.role", description: "/whitelist role — manage role-to-permission mappings" },
    { node: "whitelist.command.user", description: "/whitelist user — manage whitelist users" },
    { node: "whitelist.command.stats", description: "/whitelist stats — whitelist statistics" },
    { node: "whitelist.command.generate", description: "/whitelist generate — generate the encoded whitelist" },
    { node: "whitelist.command.validate", description: "/whitelist validate — validate/cleanup whitelist access" },
  ],
  verification: [
    {
      node: "verification.manage",
      description:
        "/verify manage [user] — staff manage another member's verification (/verify account is open self-service)",
    },
  ],
  vrchat: [
    { node: "vrchat.command.request", description: "/vrchat request — VRChat invite/friend requests" },
    { node: "vrchat.command.avatar-invite", description: "/vrchat avatar-invite — send avatar world invites" },
    { node: "vrchat.command.rolesync", description: "/group rolesync — sync a member's VRChat group roles" },
    { node: "vrchat.command.bulkrolesync", description: "/group bulkrolesync — bulk VRChat group role sync" },
    { node: "vrchat.command.role-mapping", description: "/group role map|unmap|list|fetch-roles — role mappings" },
  ],
  rooftop: [
    { node: "rooftop.command.force-update", description: "/rooftop force-update — force update rooftop files on GitHub" },
    { node: "rooftop.command.announcement", description: "/rooftop announcement — add a rooftop announcement" },
    { node: "rooftop.command.spinthebottle", description: "/rooftop spinthebottle — add a spin the bottle response" },
  ],
  phantomcompiler: [
    { node: "phantomcompiler.command.panel", description: "/phantomcompiler panel — post the phantom compiler panel" },
    { node: "phantomcompiler.command.add", description: "/phantomcompiler add — enroll another member" },
  ],
  user: [
    { node: "user.command.list", description: "/user list — list verified users" },
    { node: "user.command.role", description: "/user role — user role operations" },
  ],
  dev: [
    // Dev commands additionally keep a hard bot-owner check.
    { node: "dev.command.eval", description: "/dev eval — evaluate code (bot owner only)" },
    { node: "dev.command.leaveguild", description: "/dev leaveguild — make the bot leave a guild (bot owner only)" },
    { node: "dev.command.servers", description: "/dev servers — list servers (bot owner only)" },
    { node: "dev.command.schedule", description: "/dev schedule — manually trigger scheduled jobs (bot owner only)" },
  ],
  events: [
    { node: "events.command.schedule", description: "/event schedule — schedule a planned event" },
    { node: "events.command.export", description: "/event export — export the weekly schedule" },
    { node: "events.command.cancel", description: "/event cancel — cancel own pending/approved events" },
    { node: "events.command.edit", description: "/event edit — reopen own pending/denied events for editing" },
    { node: "events.command.submit", description: "/event submit — submit a draft for approval" },
    { node: "events.manage.approve", description: "Approve/deny/cancel planned events in the planning channel" },
    { node: "events.schedule.force", description: "Bypass event scheduling rule failures with force" },
  ],
  permissions: [
    { node: "permissions.manage", description: "/permissions grant|revoke|list — manage permission nodes" },
  ],
  roles: [
    { node: "roles.host", description: "Marker: member counts as a full event Host" },
    { node: "roles.jrhost", description: "Marker: member counts as a Jr. event Host" },
  ],
};

/** Flat list of every registered node name. */
export const ALL_PERMISSION_NODES: string[] = Object.values(
  PERMISSION_NODE_REGISTRY,
).flatMap((defs) => defs.map((d) => d.node));

/**
 * All values that make sense as a grant: every concrete node, plus "*" and
 * area/segment wildcards derived from the registry (e.g. "patrol.*",
 * "patrol.command.*").
 */
export const ALL_GRANTABLE_NODES: string[] = (() => {
  const wildcards = new Set<string>(["*"]);
  for (const node of ALL_PERMISSION_NODES) {
    const parts = node.split(".");
    for (let i = 1; i < parts.length; i++) {
      wildcards.add(`${parts.slice(0, i).join(".")}.*`);
    }
  }
  return [...wildcards, ...ALL_PERMISSION_NODES];
})();

/**
 * Whether a value is acceptable for /permissions grant: a registered node,
 * "*", or a wildcard whose prefix matches at least one registered node.
 */
export function isValidGrantNode(node: string): boolean {
  if (node === "*") {
    return true;
  }
  if (ALL_PERMISSION_NODES.includes(node)) {
    return true;
  }
  if (node.endsWith(".*")) {
    const prefix = node.slice(0, -1); // keep trailing dot
    return ALL_PERMISSION_NODES.some((n) => n.startsWith(prefix));
  }
  return false;
}

/** Whether a granted node (possibly a wildcard) satisfies a required node. */
export function nodeMatches(granted: string, required: string): boolean {
  if (granted === "*" || granted === required) {
    return true;
  }
  if (granted.endsWith(".*")) {
    return required.startsWith(granted.slice(0, -1)); // keep trailing dot
  }
  return false;
}

interface GuildNodeCache {
  expiresAt: number;
  byRole: Map<string, string[]>;
}

const CACHE_TTL_MS = 30_000;
const guildNodeCache = new Map<string, GuildNodeCache>();

/** Drop the cached role->nodes map for a guild (call after grant/revoke). */
export function invalidatePermissionNodeCache(guildId: string): void {
  guildNodeCache.delete(guildId);
}

async function getGuildRoleNodes(
  guildId: string,
): Promise<Map<string, string[]>> {
  const cached = guildNodeCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.byRole;
  }

  const rows = await prisma.rolePermission.findMany({
    where: { guildId },
    select: { roleId: true, node: true },
  });

  const byRole = new Map<string, string[]>();
  for (const row of rows) {
    const nodes = byRole.get(row.roleId);
    if (nodes) {
      nodes.push(row.node);
    } else {
      byRole.set(row.roleId, [row.node]);
    }
  }

  guildNodeCache.set(guildId, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    byRole,
  });
  return byRole;
}

/**
 * Check whether a member holds a permission node through any of their roles.
 * Discord Administrator and the configured BOT_OWNER_ID always pass.
 */
export async function hasNode(
  member: GuildMember,
  node: string,
): Promise<boolean> {
  const botOwnerId = getEnv().BOT_OWNER_ID;
  if (botOwnerId && member.id === botOwnerId) {
    return true;
  }
  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  try {
    const byRole = await getGuildRoleNodes(member.guild.id);
    for (const roleId of member.roles.cache.keys()) {
      const granted = byRole.get(roleId);
      if (granted && granted.some((g) => nodeMatches(g, node))) {
        return true;
      }
    }
  } catch (error) {
    loggers.bot.error("Failed to resolve permission nodes", error);
  }
  return false;
}

/** Collect every node grant the member has (for display purposes). */
export async function getMemberNodeGrants(
  member: GuildMember,
): Promise<string[]> {
  try {
    const byRole = await getGuildRoleNodes(member.guild.id);
    const grants = new Set<string>();
    for (const roleId of member.roles.cache.keys()) {
      for (const node of byRole.get(roleId) ?? []) {
        grants.add(node);
      }
    }
    return [...grants].sort();
  } catch (error) {
    loggers.bot.error("Failed to get member node grants", error);
    return [];
  }
}

