import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  type Message,
  type MessageActionRowComponentBuilder,
  type MessageCreateOptions,
  type MessageEditOptions,
} from "discord.js";
import type { AuditLogManager } from "./auditLogManager.js";
import {
  LOGGING_COLORS,
  type LoggingSeverity,
  type LoggingThreadKey,
  provideReasonMsgButtonCustomId,
  provideReasonPromptButtonCustomId,
  unresolvedClaimButtonCustomId,
} from "./loggingTypes.js";
import { prefersModReasonPing } from "../../utility/userPreferences.js";

const GATEWAY_REASON_RE = /\(gateway\)\s*$/i;
const PING_LINE_RE =
  /^<@\d+>\s+Please \*\*Provide the reason\*\* for this action\.\s*/m;

/** True when a moderation reason is missing or only a gateway placeholder. */
export function isMissingModReason(reason: string | null | undefined): boolean {
  if (!reason || !reason.trim()) {
    return true;
  }
  return GATEWAY_REASON_RE.test(reason.trim());
}

export function missingReasonContent(staffUserId: string): string {
  return `<@${staffUserId}> Please **Provide the reason** for this action.`;
}

export function provideReasonMsgRow(): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(provideReasonMsgButtonCustomId())
      .setLabel("Provide the reason")
      .setStyle(ButtonStyle.Secondary),
  );
}

function accentForSeverity(severity: LoggingSeverity): number {
  const color = LOGGING_COLORS[severity];
  return typeof color === "number" ? color : 0x5865f2;
}

function formatFieldsAsV2Body(
  fields: { name: string; value: string }[],
): string {
  return fields.map((f) => `**${f.name}**\n${f.value}`).join("\n\n");
}

/**
 * Legacy Components V2 mod log that pings the staff member inside the log body.
 * Kept for resolving older in-channel prompts; new prompts go to the Reasons thread.
 */
export function buildMissingReasonModLogV2(options: {
  title: string;
  severity?: LoggingSeverity;
  accentColor?: number;
  fields: { name: string; value: string }[];
  staffUserId: string;
  /** Include unresolved Claim button (unknown Discord executor). */
  includeClaimButton?: boolean;
}): MessageCreateOptions {
  const fieldsWithReason = [...options.fields];
  if (!fieldsWithReason.some((f) => f.name === "Reason")) {
    fieldsWithReason.push({
      name: "Reason",
      value: "*No reason provided*",
    });
  }

  const body = [
    missingReasonContent(options.staffUserId),
    "",
    `### ${options.title}`,
    "",
    formatFieldsAsV2Body(fieldsWithReason),
  ]
    .join("\n")
    .slice(0, 3900);

  const buttons: ButtonBuilder[] = [];
  if (options.includeClaimButton) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(unresolvedClaimButtonCustomId())
        .setLabel("Claim")
        .setStyle(ButtonStyle.Primary),
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(provideReasonMsgButtonCustomId())
      .setLabel("Provide the reason")
      .setStyle(ButtonStyle.Secondary),
  );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
  const container = new ContainerBuilder()
    .setAccentColor(
      options.accentColor ?? accentForSeverity(options.severity ?? "warn"),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
    .addActionRowComponents(row);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], users: [options.staffUserId] },
  };
}

/**
 * Reasons-thread prompt: pings staff (when notify), summarizes the action,
 * links the category log, and carries a button that targets that log.
 */
export function buildReasonsThreadPrompt(options: {
  title: string;
  severity?: LoggingSeverity;
  fields: { name: string; value: string }[];
  staffUserId: string;
  logChannelId: string;
  logMessageId: string;
  logJumpUrl: string;
  /** When false, mention text is still present but Discord will not notify. */
  notify: boolean;
}): MessageCreateOptions {
  const fieldsWithReason = [...options.fields];
  if (!fieldsWithReason.some((f) => f.name === "Reason")) {
    fieldsWithReason.push({
      name: "Reason",
      value: "*No reason provided*",
    });
  }
  if (!fieldsWithReason.some((f) => f.name === "Log")) {
    fieldsWithReason.push({
      name: "Log",
      value: `[Jump to log](${options.logJumpUrl})`,
    });
  }

  const body = [
    missingReasonContent(options.staffUserId),
    "",
    `### ${options.title}`,
    "",
    formatFieldsAsV2Body(fieldsWithReason),
  ]
    .join("\n")
    .slice(0, 3900);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        provideReasonPromptButtonCustomId(
          options.logChannelId,
          options.logMessageId,
        ),
      )
      .setLabel("Provide the reason")
      .setStyle(ButtonStyle.Secondary),
  );

  const container = new ContainerBuilder()
    .setAccentColor(accentForSeverity(options.severity ?? "warn"))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
    .addActionRowComponents(row);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: options.notify
      ? { parse: [], users: [options.staffUserId] }
      : { parse: [] },
  };
}

/** Apply a reason to an existing Components V2 reason-prompt without re-pinging. */
export function buildResolvedReasonModLogV2Edit(
  message: Message,
  reason: string,
): MessageEditOptions | null {
  if (!message.flags.has(MessageFlags.IsComponentsV2)) {
    return null;
  }

  let accent = 0x5865f2;
  const textParts: string[] = [];
  let hadClaim = false;

  for (const top of message.components) {
    if (top.type !== ComponentType.Container) {
      continue;
    }
    accent = top.accentColor || accent;
    for (const child of top.components) {
      if (child.type === ComponentType.TextDisplay) {
        textParts.push(child.content);
      }
      if (child.type === ComponentType.ActionRow) {
        for (const btn of child.components) {
          if (
            "customId" in btn &&
            btn.customId === unresolvedClaimButtonCustomId()
          ) {
            hadClaim = true;
          }
        }
      }
    }
  }

  let text = textParts.join("\n");
  text = text.replace(PING_LINE_RE, "");
  if (text.includes("*No reason provided*")) {
    text = text.replace(/\*No reason provided\*/g, reason.slice(0, 1024));
  } else if (/\*\*Reason\*\*/i.test(text)) {
    text = text.replace(
      /(\*\*Reason\*\*\n)([\s\S]*?)(?=\n\n\*\*|$)/i,
      `$1${reason.slice(0, 1024)}`,
    );
  } else {
    text = `${text.trim()}\n\n**Reason**\n${reason.slice(0, 1024)}`;
  }
  text = text.trim().slice(0, 3900);

  const container = new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

  if (hadClaim) {
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(unresolvedClaimButtonCustomId())
          .setLabel("Claim")
          .setStyle(ButtonStyle.Primary),
      ),
    );
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export type StaffActionLogOptions = {
  guildId: string;
  category: LoggingThreadKey;
  title: string;
  severity?: LoggingSeverity;
  fields: { name: string; value: string; inline?: boolean }[];
  /** Staff who performed the action - prompted when reason is missing. */
  executorId?: string | null;
  reason?: string | null;
  /** When true, never prompt for a reason (any bot / automated executor). */
  executorIsBot?: boolean;
  /** When true, never prompt (e.g. unresolved / forced skip). */
  skipReasonPrompt?: boolean;
  /** Show Claim when executor is unknown. */
  claimIfUnresolved?: boolean;
  sourceChannelId?: string | null;
  /**
   * When set, mark this Discord audit entry consumed only after a successful
   * send so the safety-net fallback remains available on soft-fail/early return.
   */
  auditEntryId?: string | null;
};

function owesReasonPrompt(options: {
  executorId?: string | null;
  reason?: string | null;
  executorIsBot?: boolean;
  skipReasonPrompt?: boolean;
}): options is {
  executorId: string;
  reason?: string | null;
  executorIsBot?: boolean;
  skipReasonPrompt?: boolean;
} {
  return (
    !!options.executorId &&
    !options.skipReasonPrompt &&
    !options.executorIsBot &&
    isMissingModReason(options.reason)
  );
}

/**
 * Post a missing-reason prompt into the Reasons forum thread, linking the
 * category log. Notification respects the staff member's ping preference;
 * opted-out staff still appear in the thread without a Discord ping.
 */
export async function postMissingReasonPrompt(
  auditLog: AuditLogManager,
  options: {
    guildId: string;
    title: string;
    severity?: LoggingSeverity;
    fields: { name: string; value: string }[];
    staffUserId: string;
    logMessage: Message;
  },
): Promise<Message | null> {
  const notify = await prefersModReasonPing(options.staffUserId);
  return auditLog.postRawToCategory(
    options.guildId,
    "reasons",
    buildReasonsThreadPrompt({
      title: options.title,
      severity: options.severity,
      fields: options.fields,
      staffUserId: options.staffUserId,
      logChannelId: options.logMessage.channelId,
      logMessageId: options.logMessage.id,
      logJumpUrl: options.logMessage.url,
      notify,
    }),
  );
}

/**
 * Posts a staff action log as a classic category embed.
 * When a human executor owes a reason, also posts a prompt in the Reasons thread.
 */
export async function postStaffActionLog(
  auditLog: AuditLogManager,
  options: StaffActionLogOptions,
): Promise<Message | null> {
  const severity = options.severity ?? "info";
  const hasExecutor = !!options.executorId;
  const reasonMissing = isMissingModReason(options.reason);
  const needsPrompt = owesReasonPrompt(options);

  const fields = [...options.fields];
  if (options.reason && !reasonMissing) {
    if (!fields.some((f) => f.name === "Reason")) {
      fields.push({
        name: "Reason",
        value: options.reason.slice(0, 1024),
      });
    }
  } else if (needsPrompt) {
    if (!fields.some((f) => f.name === "Reason")) {
      fields.push({
        name: "Reason",
        value: "*No reason provided*",
      });
    }
  }

  const message = await auditLog.postLog({
    guildId: options.guildId,
    category: options.category,
    title: options.title,
    severity,
    fields,
    components:
      options.claimIfUnresolved && !hasExecutor
        ? [
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(unresolvedClaimButtonCustomId())
                .setLabel("Claim")
                .setStyle(ButtonStyle.Primary),
            ),
          ]
        : undefined,
    sourceChannelId: options.sourceChannelId,
    auditEntryId: options.auditEntryId,
  });

  if (message && needsPrompt && options.executorId) {
    await postMissingReasonPrompt(auditLog, {
      guildId: options.guildId,
      title: options.title,
      severity,
      fields: options.fields.map((f) => ({ name: f.name, value: f.value })),
      staffUserId: options.executorId,
      logMessage: message,
    });
  }

  return message;
}

/**
 * @deprecated Prefer postStaffActionLog / postMissingReasonPrompt.
 * Returns a Reasons-thread-ready V2 payload only when the actor owes a reason
 * and prefers pings (legacy VRChat fan-out path).
 */
export async function buildStaffActionV2OrNull(options: {
  title: string;
  severity?: LoggingSeverity;
  fields: { name: string; value: string }[];
  executorId?: string | null;
  reason?: string | null;
  executorIsBot?: boolean;
  skipReasonPrompt?: boolean;
}): Promise<MessageCreateOptions | null> {
  if (
    options.skipReasonPrompt ||
    options.executorIsBot ||
    !options.executorId ||
    !isMissingModReason(options.reason) ||
    !(await prefersModReasonPing(options.executorId))
  ) {
    return null;
  }
  return buildMissingReasonModLogV2({
    title: options.title,
    severity: options.severity ?? "warn",
    fields: options.fields,
    staffUserId: options.executorId,
  });
}

/** @deprecated Prefer postStaffActionLog / buildReasonsThreadPrompt */
export function reasonPromptPostOptions(
  executorId: string | null | undefined,
  reason: string | null | undefined,
  existingComponents?: ActionRowBuilder<MessageActionRowComponentBuilder>[],
): {
  needsReason: boolean;
  content?: string;
  allowedMentions?: { parse: []; users: string[] };
  components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
  reasonField?: { name: string; value: string };
} {
  const needsReason = !!executorId && isMissingModReason(reason);
  if (!needsReason || !executorId) {
    return {
      needsReason: false,
      components: existingComponents,
    };
  }

  const rows = [...(existingComponents ?? [])];
  rows.push(provideReasonMsgRow());
  return {
    needsReason: true,
    content: missingReasonContent(executorId),
    allowedMentions: { parse: [], users: [executorId] },
    components: rows,
    reasonField: { name: "Reason", value: "*No reason provided*" },
  };
}

/** Upsert a Reason field on an embed field list. */
export function upsertReasonField(
  fields: { name: string; value: string; inline?: boolean }[],
  reason: string,
): { name: string; value: string; inline?: boolean }[] {
  const next = fields.map((f) => ({ ...f }));
  const idx = next.findIndex((f) => f.name === "Reason");
  const field = {
    name: "Reason",
    value: reason.slice(0, 1024),
    inline: false,
  };
  if (idx >= 0) {
    next[idx] = field;
  } else {
    next.push(field);
  }
  return next;
}
