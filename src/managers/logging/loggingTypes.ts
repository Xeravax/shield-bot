import { ColorResolvable } from "discord.js";

/** Persistent forum thread category keys (stored in GuildSettings.loggingThreadIds). */
export const LOGGING_THREAD_KEYS = [
  "messages",
  "channels",
  "roles",
  "members",
  "voice",
  "server",
  "moderation",
  "reactions",
  "events",
  "automod",
  "integrations",
] as const;

export type LoggingThreadKey = (typeof LOGGING_THREAD_KEYS)[number];

export const LOGGING_THREAD_NAMES: Record<LoggingThreadKey, string> = {
  messages: "Messages",
  channels: "Channels",
  roles: "Roles",
  members: "Members",
  voice: "Voice",
  server: "Server",
  moderation: "Moderation",
  reactions: "Reactions",
  events: "Events",
  automod: "AutoMod",
  integrations: "Integrations",
};

export type LoggingSeverity = "info" | "warn" | "danger" | "success" | "mod";

export const LOGGING_COLORS: Record<LoggingSeverity, ColorResolvable> = {
  info: 0x5865f2,
  warn: 0xfaa61a,
  danger: 0xed4245,
  success: 0x57f287,
  mod: 0xeb459e,
};

export type InviteFilterAction = "log" | "delete" | "delete_timeout";

export const INVITE_FILTER_ACTIONS: InviteFilterAction[] = [
  "log",
  "delete",
  "delete_timeout",
];

export const DEFAULT_MESSAGE_RETENTION_DAYS = 30;

export const CLAIM_BUTTON_PREFIX = "logging:claim:";
export const CLAIM_MODAL_PREFIX = "logging:claim-modal:";
/** Claim an audit log embed when Discord did not resolve an executor. */
export const UNRESOLVED_CLAIM_BUTTON_ID = "logging:claim-unresolved";
export const UNRESOLVED_CLAIM_MODAL_PREFIX = "logging:claim-unresolved-modal:";

export function claimButtonCustomId(caseId: number): string {
  return `${CLAIM_BUTTON_PREFIX}${caseId}`;
}

export function claimModalCustomId(caseId: number): string {
  return `${CLAIM_MODAL_PREFIX}${caseId}`;
}

export function unresolvedClaimButtonCustomId(): string {
  return UNRESOLVED_CLAIM_BUTTON_ID;
}

export function unresolvedClaimModalCustomId(
  channelId: string,
  messageId: string,
): string {
  return `${UNRESOLVED_CLAIM_MODAL_PREFIX}${channelId}:${messageId}`;
}

export function parseLoggingThreadIds(
  value: unknown,
): Partial<Record<LoggingThreadKey, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Partial<Record<LoggingThreadKey, string>> = {};
  for (const key of LOGGING_THREAD_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw === "string" && raw.length > 0) {
      out[key] = raw;
    }
  }
  return out;
}

export function parseStringIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}
