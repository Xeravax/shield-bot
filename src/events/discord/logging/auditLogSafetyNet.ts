import { ArgsOf, Discord, On } from "discordx";
import {
  AuditLogEvent,
  Guild,
  GuildAuditLogsEntry,
  type AuditLogChange,
} from "discord.js";
import {
  auditLogManager,
  auditLogSeen,
  prisma,
} from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import {
  claimComponentsIfUnresolved,
  postStaffActionLog,
  unknownExecutorField,
  type LoggingThreadKey,
} from "../../../managers/logging/index.js";

const FALLBACK_DELAY_MS = 3_000;
const CATCHUP_LIMIT = 100;

const SECRET_KEY_RE = /token|url|secret|password|avatar/i;

/** Actions logged immediately from the audit-entry event (no rich gateway handler). */
const AUDIT_ONLY = new Set<AuditLogEvent>([
  AuditLogEvent.MemberPrune,
  AuditLogEvent.InviteUpdate,
  AuditLogEvent.WebhookCreate,
  AuditLogEvent.WebhookUpdate,
  AuditLogEvent.WebhookDelete,
  AuditLogEvent.OnboardingPromptCreate,
  AuditLogEvent.OnboardingPromptUpdate,
  AuditLogEvent.OnboardingPromptDelete,
  AuditLogEvent.OnboardingCreate,
  AuditLogEvent.OnboardingUpdate,
  AuditLogEvent.HomeSettingsCreate,
  AuditLogEvent.HomeSettingsUpdate,
]);

/**
 * Actions with rich gateway handlers that mark entries consumed via
 * DiscordAuditResolver. Only these get a delayed fallback if the gateway
 * event was dropped.
 */
const DELAYED_FALLBACK = new Set<AuditLogEvent>([
  AuditLogEvent.GuildUpdate,
  AuditLogEvent.ChannelCreate,
  AuditLogEvent.ChannelUpdate,
  AuditLogEvent.ChannelDelete,
  AuditLogEvent.ChannelOverwriteCreate,
  AuditLogEvent.ChannelOverwriteUpdate,
  AuditLogEvent.ChannelOverwriteDelete,
  AuditLogEvent.MemberKick,
  AuditLogEvent.MemberBanAdd,
  AuditLogEvent.MemberBanRemove,
  AuditLogEvent.MemberUpdate,
  AuditLogEvent.MemberRoleUpdate,
  AuditLogEvent.MemberMove,
  AuditLogEvent.MemberDisconnect,
  AuditLogEvent.RoleCreate,
  AuditLogEvent.RoleUpdate,
  AuditLogEvent.RoleDelete,
  AuditLogEvent.MessageDelete,
  AuditLogEvent.MessageBulkDelete,
  AuditLogEvent.StageInstanceUpdate,
  AuditLogEvent.GuildScheduledEventCreate,
  AuditLogEvent.GuildScheduledEventUpdate,
  AuditLogEvent.GuildScheduledEventDelete,
  AuditLogEvent.SoundboardSoundCreate,
  AuditLogEvent.SoundboardSoundUpdate,
  AuditLogEvent.SoundboardSoundDelete,
  AuditLogEvent.AutoModerationRuleCreate,
  AuditLogEvent.AutoModerationRuleUpdate,
  AuditLogEvent.AutoModerationRuleDelete,
  AuditLogEvent.IntegrationCreate,
  AuditLogEvent.IntegrationUpdate,
  AuditLogEvent.IntegrationDelete,
  AuditLogEvent.ApplicationCommandPermissionUpdate,
]);

function categoryForAction(action: AuditLogEvent): LoggingThreadKey {
  switch (action) {
    case AuditLogEvent.MessageDelete:
    case AuditLogEvent.MessageBulkDelete:
    case AuditLogEvent.MessagePin:
    case AuditLogEvent.MessageUnpin:
      return "messages";
    case AuditLogEvent.ChannelCreate:
    case AuditLogEvent.ChannelUpdate:
    case AuditLogEvent.ChannelDelete:
    case AuditLogEvent.ChannelOverwriteCreate:
    case AuditLogEvent.ChannelOverwriteUpdate:
    case AuditLogEvent.ChannelOverwriteDelete:
    case AuditLogEvent.ThreadCreate:
    case AuditLogEvent.ThreadUpdate:
    case AuditLogEvent.ThreadDelete:
    case AuditLogEvent.StageInstanceCreate:
    case AuditLogEvent.StageInstanceUpdate:
    case AuditLogEvent.StageInstanceDelete:
    case AuditLogEvent.VoiceChannelStatusCreate:
    case AuditLogEvent.VoiceChannelStatusDelete:
      return "channels";
    case AuditLogEvent.RoleCreate:
    case AuditLogEvent.RoleUpdate:
    case AuditLogEvent.RoleDelete:
    case AuditLogEvent.MemberRoleUpdate:
      return "roles";
    case AuditLogEvent.MemberKick:
    case AuditLogEvent.MemberPrune:
    case AuditLogEvent.MemberUpdate:
    case AuditLogEvent.BotAdd:
      return "members";
    case AuditLogEvent.MemberBanAdd:
    case AuditLogEvent.MemberBanRemove:
      return "moderation";
    case AuditLogEvent.MemberMove:
    case AuditLogEvent.MemberDisconnect:
      return "voice";
    case AuditLogEvent.GuildScheduledEventCreate:
    case AuditLogEvent.GuildScheduledEventUpdate:
    case AuditLogEvent.GuildScheduledEventDelete:
      return "events";
    case AuditLogEvent.AutoModerationRuleCreate:
    case AuditLogEvent.AutoModerationRuleUpdate:
    case AuditLogEvent.AutoModerationRuleDelete:
    case AuditLogEvent.AutoModerationBlockMessage:
    case AuditLogEvent.AutoModerationFlagToChannel:
    case AuditLogEvent.AutoModerationUserCommunicationDisabled:
    case AuditLogEvent.AutoModerationQuarantineUser:
      return "automod";
    case AuditLogEvent.IntegrationCreate:
    case AuditLogEvent.IntegrationUpdate:
    case AuditLogEvent.IntegrationDelete:
    case AuditLogEvent.ApplicationCommandPermissionUpdate:
      return "integrations";
    default:
      return "server";
  }
}

function actionTitle(action: AuditLogEvent): string {
  const name = AuditLogEvent[action] ?? String(action);
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatChangeValue(value: unknown): string {
  if (value == null) {
    return "*none*";
  }
  if (typeof value === "string") {
    return value.slice(0, 200);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value).slice(0, 200);
  } catch {
    return String(value).slice(0, 200);
  }
}

function formatChanges(changes: AuditLogChange[]): string {
  const lines: string[] = [];
  for (const change of changes) {
    if (SECRET_KEY_RE.test(change.key)) {
      lines.push(`\`${change.key}\`: *(redacted)*`);
      continue;
    }
    lines.push(
      `\`${change.key}\`: ${formatChangeValue(change.old)} → ${formatChangeValue(change.new)}`,
    );
  }
  return lines.join("\n").slice(0, 1024) || "*none*";
}

function targetLabel(entry: GuildAuditLogsEntry): string {
  const target = entry.target as {
    id?: string;
    name?: string;
    code?: string;
  } | null;
  if (!target) {
    return entry.targetId ? `\`${entry.targetId}\`` : "*unknown*";
  }
  if (typeof target.code === "string") {
    return `\`${target.code}\``;
  }
  if (typeof target.name === "string") {
    return `${target.name}${target.id ? ` (\`${target.id}\`)` : ""}`;
  }
  if (target.id) {
    return `<@${target.id}> (\`${target.id}\`)`;
  }
  return "*unknown*";
}

function webhookSafeFields(entry: GuildAuditLogsEntry): {
  name: string;
  value: string;
  inline?: boolean;
}[] {
  const target = entry.target as { id?: string; name?: string } | null;
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (target?.name || target?.id) {
    fields.push({
      name: "Webhook",
      value: target.name
        ? `${target.name}${target.id ? ` (\`${target.id}\`)` : ""}`
        : `\`${target.id}\``,
    });
  }
  for (const change of entry.changes) {
    if (change.key === "channel_id") {
      fields.push({
        name: "Channel",
        value: auditLogManager.formatChannel(
          String(change.new ?? change.old ?? "unknown"),
        ),
      });
    } else if (change.key === "name") {
      fields.push({
        name: "Name",
        value: `${formatChangeValue(change.old)} → ${formatChangeValue(change.new)}`,
      });
    }
    // Never include token, url, or avatar
  }
  return fields;
}

function executorUser(entry: GuildAuditLogsEntry): {
  id: string;
  username: string | null;
  bot: boolean;
} | null {
  if (!entry.executorId) {
    return null;
  }
  const ex = entry.executor;
  if (ex && "username" in ex) {
    return {
      id: ex.id,
      username: ex.username ?? null,
      bot: "bot" in ex ? !!ex.bot : false,
    };
  }
  return { id: entry.executorId, username: null, bot: false };
}

async function postAuditOnly(
  guild: Guild,
  entry: GuildAuditLogsEntry,
): Promise<void> {
  const executor = executorUser(entry);
  const action = entry.action;

  if (action === AuditLogEvent.MemberPrune) {
    const extra = entry.extra as { removed?: number; days?: number } | null;
    const fields: { name: string; value: string; inline?: boolean }[] = [
      {
        name: "Members removed",
        value: String(extra?.removed ?? "*unknown*"),
        inline: true,
      },
      {
        name: "Inactivity days",
        value: String(extra?.days ?? "*unknown*"),
        inline: true,
      },
    ];
    if (executor) {
      fields.push({
        name: "Executor",
        value: await auditLogManager.formatUser(executor.id, executor.username),
      });
    } else {
      fields.push(unknownExecutorField());
    }
    await postStaffActionLog(auditLogManager, {
      guildId: guild.id,
      category: "members",
      title: "Members Pruned",
      severity: "danger",
      fields,
      executorId: executor?.id,
      reason: entry.reason,
      executorIsBot: !!executor?.bot,
      claimIfUnresolved: !executor,
    });
    return;
  }

  if (action === AuditLogEvent.InviteUpdate) {
    const target = entry.target as {
      code?: string;
      channelId?: string | null;
    } | null;
    const fields: { name: string; value: string; inline?: boolean }[] = [
      {
        name: "Code",
        value: target?.code ? `\`${target.code}\`` : targetLabel(entry),
        inline: true,
      },
    ];
    if (target?.channelId) {
      fields.push({
        name: "Channel",
        value: auditLogManager.formatChannel(target.channelId),
        inline: true,
      });
    }
    fields.push({
      name: "Changes",
      value: formatChanges(
        entry.changes.filter((c) => !SECRET_KEY_RE.test(c.key)),
      ),
    });
    if (executor) {
      fields.push({
        name: "Executor",
        value: await auditLogManager.formatUser(executor.id, executor.username),
      });
    } else {
      fields.push(unknownExecutorField());
    }
    await auditLogManager.postLog({
      guildId: guild.id,
      category: "server",
      title: "Invite Updated",
      severity: "info",
      fields,
      components: claimComponentsIfUnresolved(!!executor),
    });
    return;
  }

  if (
    action === AuditLogEvent.WebhookCreate ||
    action === AuditLogEvent.WebhookUpdate ||
    action === AuditLogEvent.WebhookDelete
  ) {
    const title =
      action === AuditLogEvent.WebhookCreate
        ? "Webhook Created"
        : action === AuditLogEvent.WebhookUpdate
          ? "Webhook Updated"
          : "Webhook Deleted";
    const severity =
      action === AuditLogEvent.WebhookCreate
        ? "success"
        : action === AuditLogEvent.WebhookDelete
          ? "danger"
          : "info";
    const fields = webhookSafeFields(entry);
    if (executor) {
      fields.push({
        name: "Executor",
        value: await auditLogManager.formatUser(executor.id, executor.username),
      });
    } else {
      fields.push(unknownExecutorField());
    }
    await auditLogManager.postLog({
      guildId: guild.id,
      category: "server",
      title,
      severity,
      fields:
        fields.length > 0
          ? fields
          : [{ name: "Detail", value: "Webhook changed (details redacted)" }],
      components: claimComponentsIfUnresolved(!!executor),
    });
    return;
  }

  // Onboarding / home settings → server
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Target", value: targetLabel(entry) },
  ];
  if (entry.changes.length) {
    fields.push({ name: "Changes", value: formatChanges(entry.changes) });
  }
  if (executor) {
    fields.push({
      name: "Executor",
      value: await auditLogManager.formatUser(executor.id, executor.username),
    });
  } else {
    fields.push(unknownExecutorField());
  }
  await auditLogManager.postLog({
    guildId: guild.id,
    category: "server",
    title: actionTitle(action),
    severity: "info",
    fields,
    components: claimComponentsIfUnresolved(!!executor),
  });
}

async function postFallback(
  guild: Guild,
  entry: GuildAuditLogsEntry,
): Promise<void> {
  const executor = executorUser(entry);
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Target", value: targetLabel(entry) },
  ];
  if (entry.changes.length) {
    fields.push({ name: "Changes", value: formatChanges(entry.changes) });
  }
  if (executor) {
    fields.push({
      name: "Executor",
      value: await auditLogManager.formatUser(executor.id, executor.username),
    });
  } else {
    fields.push(unknownExecutorField());
  }
  if (entry.reason) {
    fields.push({ name: "Reason", value: entry.reason.slice(0, 1024) });
  }
  await auditLogManager.postLog({
    guildId: guild.id,
    category: categoryForAction(entry.action),
    title: `${actionTitle(entry.action)} (audit fallback)`,
    severity: "warn",
    fields,
    components: claimComponentsIfUnresolved(!!executor),
    footer: `Audit entry ${entry.id}`,
  });
}

function sortAuditEntries(entries: GuildAuditLogsEntry[]): GuildAuditLogsEntry[] {
  return [...entries].sort((a, b) => {
    try {
      const diff = BigInt(a.id) - BigInt(b.id);
      return diff < 0n ? -1 : diff > 0n ? 1 : 0;
    } catch {
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }
  });
}

/**
 * Process a single audit log entry through the safety net.
 * Returns false when catch-up posting failed so the cursor is not advanced past it.
 * Live path always returns true (cursor advanced separately / delayed).
 */
export async function processAuditLogEntry(
  guild: Guild,
  entry: GuildAuditLogsEntry,
  options?: { fromCatchup?: boolean },
): Promise<boolean> {
  const fromCatchup = options?.fromCatchup === true;

  if (auditLogSeen.wasConsumed(guild.id, entry.id)) {
    if (!fromCatchup) {
      await auditLogSeen.advanceCursor(guild.id, entry.id);
    }
    return true;
  }

  if (AUDIT_ONLY.has(entry.action)) {
    if (!auditLogSeen.tryConsume(guild.id, entry.id)) {
      if (!fromCatchup) {
        await auditLogSeen.advanceCursor(guild.id, entry.id);
      }
      return true;
    }
    let ok = true;
    try {
      await postAuditOnly(guild, entry);
    } catch (error) {
      ok = false;
      loggers.bot.debug("audit-only log failed", {
        guildId: guild.id,
        entryId: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (!fromCatchup) {
      await auditLogSeen.advanceCursor(guild.id, entry.id);
    }
    return ok;
  }

  // Not in our fallback set — gateway handler logs without audit resolve, or
  // we do not care. Advance cursor so catch-up does not reprocess.
  if (!DELAYED_FALLBACK.has(entry.action)) {
    auditLogSeen.consume(guild.id, entry.id);
    if (!fromCatchup) {
      await auditLogSeen.advanceCursor(guild.id, entry.id);
    }
    return true;
  }

  // Catch-up: gateway event already missed — post fallback immediately
  if (fromCatchup) {
    if (!auditLogSeen.tryConsume(guild.id, entry.id)) {
      return true;
    }
    try {
      await postFallback(guild, entry);
      return true;
    } catch (error) {
      loggers.bot.debug("audit fallback (catchup) failed", {
        guildId: guild.id,
        entryId: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Live: wait for rich gateway handler, then fallback if still unconsumed
  const guildId = guild.id;
  const entryId = entry.id;
  setTimeout(() => {
    void (async () => {
      if (auditLogSeen.wasConsumed(guildId, entryId)) {
        await auditLogSeen.advanceCursor(guildId, entryId);
        return;
      }
      if (!auditLogSeen.tryConsume(guildId, entryId)) {
        await auditLogSeen.advanceCursor(guildId, entryId);
        return;
      }
      const g =
        guild.client.guilds.cache.get(guildId) ??
        (await guild.client.guilds.fetch(guildId).catch(() => null));
      if (!g) {
        return;
      }
      try {
        await postFallback(g, entry);
      } catch (error) {
        loggers.bot.debug("audit fallback failed", {
          guildId,
          entryId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await auditLogSeen.advanceCursor(guildId, entryId);
    })().catch((error) => {
      loggers.bot.debug("audit fallback task failed", {
        guildId,
        entryId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, FALLBACK_DELAY_MS).unref();
  return true;
}

const catchupInFlight = new Set<string>();

/**
 * Seed or catch up audit log entries after ready/resume.
 * First boot with null cursor seeds to newest and posts nothing.
 */
export async function pollGuildAuditCatchup(guild: Guild): Promise<void> {
  if (catchupInFlight.has(guild.id)) {
    return;
  }
  catchupInFlight.add(guild.id);
  try {
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: guild.id },
      select: {
        loggingForumChannelId: true,
        loggingLastAuditEntryId: true,
      },
    });
    if (!settings?.loggingForumChannelId) {
      return;
    }

    const cursor = settings.loggingLastAuditEntryId;
    if (!cursor) {
      const logs = await guild.fetchAuditLogs({ limit: CATCHUP_LIMIT });
      const entries = sortAuditEntries([...logs.entries.values()]);
      if (entries.length === 0) {
        return;
      }
      const newest = entries[entries.length - 1]!;
      await auditLogSeen.advanceCursor(guild.id, newest.id);
      loggers.bot.debug("Seeded loggingLastAuditEntryId", {
        guildId: guild.id,
        entryId: newest.id,
      });
      return;
    }

    let after = cursor;
    let highestProcessed: string | null = null;

    while (true) {
      const logs = await guild.fetchAuditLogs({
        limit: CATCHUP_LIMIT,
        after,
      });
      const page = sortAuditEntries([...logs.entries.values()]);
      if (page.length === 0) {
        break;
      }

      let failed = false;
      for (const entry of page) {
        const ok = await processAuditLogEntry(guild, entry, {
          fromCatchup: true,
        });
        if (!ok) {
          failed = true;
          break;
        }
        highestProcessed = entry.id;
      }

      if (failed) {
        break;
      }

      if (page.length < CATCHUP_LIMIT) {
        break;
      }
      after = page[page.length - 1]!.id;
    }

    if (highestProcessed) {
      await auditLogSeen.advanceCursor(guild.id, highestProcessed);
    }
  } catch (error) {
    loggers.bot.debug("pollGuildAuditCatchup failed", {
      guildId: guild.id,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    catchupInFlight.delete(guild.id);
  }
}

/** Run catch-up for every guild that has a logging forum configured. */
export async function pollAllGuildAuditCatchup(
  guilds: Iterable<Guild>,
): Promise<void> {
  for (const guild of guilds) {
    await pollGuildAuditCatchup(guild);
  }
}

@Discord()
export class LoggingAuditLogSafetyNet {
  @On({ event: "guildAuditLogEntryCreate" })
  async onAuditEntry([
    entry,
    guild,
  ]: ArgsOf<"guildAuditLogEntryCreate">): Promise<void> {
    try {
      await processAuditLogEntry(guild, entry);
    } catch (error) {
      loggers.bot.debug("guildAuditLogEntryCreate handler failed", {
        guildId: guild.id,
        entryId: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
