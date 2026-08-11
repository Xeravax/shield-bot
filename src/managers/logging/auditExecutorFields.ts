import {
  AuditLogEvent,
  Guild,
  GuildChannel,
} from "discord.js";
import { auditLogManager, discordAuditResolver } from "../../main.js";

/** Shared executor (+ optional reason) fields from Discord audit logs. */
export async function auditExecutorFields(
  guild: Guild | GuildChannel["guild"],
  type: AuditLogEvent,
  targetId?: string,
  maxAgeMs?: number,
): Promise<{ name: string; value: string; inline?: boolean }[]> {
  const audit = await discordAuditResolver.resolve(guild, type, {
    targetId,
    maxAgeMs,
  });
  if (!audit.executor) {
    return [];
  }
  const fields: { name: string; value: string; inline?: boolean }[] = [
    {
      name: "Executor",
      value: auditLogManager.formatUser(audit.executor.id, audit.executor.tag),
      inline: true,
    },
  ];
  if (audit.reason) {
    fields.push({ name: "Reason", value: audit.reason.slice(0, 1024), inline: false });
  }
  return fields;
}

/** Resolve audit actor and build executor fields in one pass (for title branching). */
export async function resolveAuditExecutor(
  guild: Guild | GuildChannel["guild"],
  type: AuditLogEvent,
  options?: { targetId?: string; maxAgeMs?: number },
) {
  const audit = await discordAuditResolver.resolve(guild, type, options);
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (audit.executor) {
    fields.push({
      name: "Executor",
      value: auditLogManager.formatUser(audit.executor.id, audit.executor.tag),
      inline: true,
    });
    if (audit.reason) {
      fields.push({
        name: "Reason",
        value: audit.reason.slice(0, 1024),
        inline: false,
      });
    }
  }
  return { audit, fields };
}
