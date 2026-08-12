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
  unresolvedClaimButtonCustomId,
} from "./loggingTypes.js";

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
 * Components V2 mod log that pings the staff member inside the log body.
 * Mentions only fire when allowedMentions includes them (set on send, cleared on edit).
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
    // Only the staff who owes a reason — never roles / everyone / other users.
    allowedMentions: { parse: [], users: [options.staffUserId] },
  };
}

/** Apply a reason to an existing Components V2 reason-prompt log without re-pinging. */
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
  /** Staff who performed the action — pinged only when reason is missing. */
  executorId?: string | null;
  reason?: string | null;
  /** When true, never ping (e.g. bot executor). */
  skipReasonPrompt?: boolean;
  /** Show Claim when executor is unknown. */
  claimIfUnresolved?: boolean;
  sourceChannelId?: string | null;
};

/**
 * Posts a staff action log.
 * - Missing reason + known executor → Components V2 with in-log ping
 * - Otherwise → classic embed (no ping)
 */
export async function postStaffActionLog(
  auditLog: AuditLogManager,
  options: StaffActionLogOptions,
): Promise<Message | null> {
  const severity = options.severity ?? "info";
  const hasExecutor = !!options.executorId;
  const needsReason =
    !options.skipReasonPrompt &&
    hasExecutor &&
    isMissingModReason(options.reason);

  if (needsReason && options.executorId) {
    if (options.sourceChannelId) {
      const ignored = await auditLog.shouldIgnoreChannel(
        options.guildId,
        options.sourceChannelId,
      );
      if (ignored) {
        return null;
      }
    }

    return auditLog.postRawToCategory(
      options.guildId,
      options.category,
      buildMissingReasonModLogV2({
        title: options.title,
        severity,
        fields: options.fields.map((f) => ({
          name: f.name,
          value: f.value,
        })),
        staffUserId: options.executorId,
        includeClaimButton: false,
      }),
    );
  }

  const fields = [...options.fields];
  if (options.reason && !isMissingModReason(options.reason)) {
    if (!fields.some((f) => f.name === "Reason")) {
      fields.push({
        name: "Reason",
        value: options.reason.slice(0, 1024),
      });
    }
  }

  return auditLog.postLog({
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
  });
}

/** Build a V2 payload for fan-out helpers (e.g. VRChat Group thread). */
export function buildStaffActionV2OrNull(options: {
  title: string;
  severity?: LoggingSeverity;
  fields: { name: string; value: string }[];
  executorId?: string | null;
  reason?: string | null;
  skipReasonPrompt?: boolean;
}): MessageCreateOptions | null {
  if (
    options.skipReasonPrompt ||
    !options.executorId ||
    !isMissingModReason(options.reason)
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

/** @deprecated Prefer postStaffActionLog / buildMissingReasonModLogV2 */
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
