import { ArgsOf, Discord, On } from "discordx";
import {
  bot,
  discordAuditResolver,
  modCaseManager,
  auditLogManager,
} from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import { AuditLogEvent } from "discord.js";
import { postStaffActionLog } from "../../../managers/logging/reasonPrompt.js";
import { unknownExecutorField } from "../../../managers/logging/auditExecutorFields.js";

/**
 * Gateway ban/unban attribution when not originated by our slash commands
 * (bot as executor within the audit window is treated as already-cased).
 */
@Discord()
export class LoggingModerationGatewayEvents {
  @On({ event: "guildBanAdd" })
  async onBan([ban]: ArgsOf<"guildBanAdd">): Promise<void> {
    try {
      if (modCaseManager.shouldSuppressGatewayCase(ban.guild.id, "BAN", ban.user.id)) {
        return;
      }

      const audit = await discordAuditResolver.resolve(
        ban.guild,
        AuditLogEvent.MemberBanAdd,
        { targetId: ban.user.id, maxAgeMs: 12_000 },
      );

      if (audit.executor?.id && bot.user?.id && audit.executor.id === bot.user.id) {
        return;
      }

      const reason = audit.reason ?? ban.reason ?? null;

      await postStaffActionLog(auditLogManager, {
        guildId: ban.guild.id,
        category: "moderation",
        title: "Member Banned",
        severity: "danger",
        fields: [
          {
            name: "User",
            value: auditLogManager.formatUser(ban.user.id, ban.user.tag),
          },
          ...(audit.executor
            ? [
                {
                  name: "Executor",
                  value: auditLogManager.formatUser(
                    audit.executor.id,
                    audit.executor.tag,
                  ),
                },
              ]
            : [unknownExecutorField()]),
        ],
        executorId: audit.executor?.id,
        reason,
        executorIsBot: !!audit.executor?.bot,
        claimIfUnresolved: !audit.executor,
      });

      await modCaseManager.createCase({
        guildId: ban.guild.id,
        type: "BAN",
        targetId: ban.user.id,
        moderatorId: audit.executor?.id ?? bot.user?.id ?? ban.user.id,
        reason: reason ?? "Ban (gateway)",
        active: true,
      });
    } catch (error) {
      loggers.bot.debug("guildBanAdd logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "guildBanRemove" })
  async onUnban([ban]: ArgsOf<"guildBanRemove">): Promise<void> {
    try {
      if (
        modCaseManager.shouldSuppressGatewayCase(ban.guild.id, "UNBAN", ban.user.id)
      ) {
        return;
      }

      const audit = await discordAuditResolver.resolve(
        ban.guild,
        AuditLogEvent.MemberBanRemove,
        { targetId: ban.user.id, maxAgeMs: 12_000 },
      );

      if (audit.executor?.id && bot.user?.id && audit.executor.id === bot.user.id) {
        return;
      }

      const reason = audit.reason ?? null;

      await postStaffActionLog(auditLogManager, {
        guildId: ban.guild.id,
        category: "moderation",
        title: "Member Unbanned",
        severity: "success",
        fields: [
          {
            name: "User",
            value: auditLogManager.formatUser(ban.user.id, ban.user.tag),
          },
          ...(audit.executor
            ? [
                {
                  name: "Executor",
                  value: auditLogManager.formatUser(
                    audit.executor.id,
                    audit.executor.tag,
                  ),
                },
              ]
            : [unknownExecutorField()]),
        ],
        executorId: audit.executor?.id,
        reason,
        executorIsBot: !!audit.executor?.bot,
        claimIfUnresolved: !audit.executor,
      });

      await modCaseManager.createCase({
        guildId: ban.guild.id,
        type: "UNBAN",
        targetId: ban.user.id,
        moderatorId: audit.executor?.id ?? bot.user?.id ?? ban.user.id,
        reason: reason ?? "Unban (gateway)",
        active: false,
      });
    } catch (error) {
      loggers.bot.debug("guildBanRemove logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
