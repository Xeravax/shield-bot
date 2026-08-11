import {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  Guild,
  GuildChannel,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { auditLogManager, discordAuditResolver } from "../../main.js";
import { unresolvedClaimButtonCustomId } from "./loggingTypes.js";

export type AuditExecutorResult = {
  fields: { name: string; value: string; inline?: boolean }[];
  /** Claim button when Discord audit log could not resolve an executor. */
  components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
};

export type AuditExecutorOptions = {
  targetId?: string;
  maxAgeMs?: number;
  /**
   * When true, show an Unknown executor field and a Claim button if Discord
   * did not resolve who performed the action. Defaults to false for
   * resolveAuditExecutor (e.g. voluntary voice leave); auditExecutorFields
   * always enables this for admin-style events.
   */
  claimIfUnresolved?: boolean;
};

function unresolvedClaimRow(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(unresolvedClaimButtonCustomId())
        .setLabel("Claim")
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function executorFields(
  executor: { id: string; tag: string } | null,
  reason: string | null,
  claimIfUnresolved: boolean,
): AuditExecutorResult {
  if (!executor) {
    if (!claimIfUnresolved) {
      return { fields: [] };
    }
    return {
      fields: [
        {
          name: "Executor",
          value: "*Unknown — claim to attribute*",
          inline: true,
        },
      ],
      components: unresolvedClaimRow(),
    };
  }

  const fields: AuditExecutorResult["fields"] = [
    {
      name: "Executor",
      value: auditLogManager.formatUser(executor.id, executor.tag),
      inline: true,
    },
  ];
  if (reason) {
    fields.push({
      name: "Reason",
      value: reason.slice(0, 1024),
      inline: false,
    });
  }
  return { fields };
}

/** Shared executor fields for admin-style events; claimable when unresolved. */
export async function auditExecutorFields(
  guild: Guild | GuildChannel["guild"],
  type: AuditLogEvent,
  targetId?: string,
  maxAgeMs?: number,
): Promise<AuditExecutorResult> {
  const audit = await discordAuditResolver.resolve(guild, type, {
    targetId,
    maxAgeMs,
  });
  return executorFields(
    audit.executor
      ? { id: audit.executor.id, tag: audit.executor.tag }
      : null,
    audit.reason,
    true,
  );
}

/** Resolve audit actor and build executor fields in one pass (for title branching). */
export async function resolveAuditExecutor(
  guild: Guild | GuildChannel["guild"],
  type: AuditLogEvent,
  options?: AuditExecutorOptions,
): Promise<
  AuditExecutorResult & {
    audit: Awaited<ReturnType<typeof discordAuditResolver.resolve>>;
  }
> {
  const audit = await discordAuditResolver.resolve(guild, type, options);
  const result = executorFields(
    audit.executor
      ? { id: audit.executor.id, tag: audit.executor.tag }
      : null,
    audit.reason,
    options?.claimIfUnresolved === true,
  );
  return { audit, ...result };
}

/** Claim row for call sites that resolve the audit log themselves. */
export function claimComponentsIfUnresolved(
  hasExecutor: boolean,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] | undefined {
  return hasExecutor ? undefined : unresolvedClaimRow();
}

/** Unknown executor field when claimable and unresolved. */
export function unknownExecutorField(): {
  name: string;
  value: string;
  inline?: boolean;
} {
  return {
    name: "Executor",
    value: "*Unknown — claim to attribute*",
    inline: true,
  };
}
