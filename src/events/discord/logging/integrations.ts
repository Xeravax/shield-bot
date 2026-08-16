import { ArgsOf, Discord, On } from "discordx";
import { AuditLogEvent } from "discord.js";
import { auditLogManager, bot, discordAuditResolver } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import {
  claimComponentsIfUnresolved,
  unknownExecutorField,
} from "../../../managers/logging/auditExecutorFields.js";

const integrationDebounce = new Map<string, NodeJS.Timeout>();

@Discord()
export class LoggingIntegrationEvents {
  @On({ event: "guildIntegrationsUpdate" })
  async onIntegrationsUpdate([
    guild,
  ]: ArgsOf<"guildIntegrationsUpdate">): Promise<void> {
    try {
      const existing = integrationDebounce.get(guild.id);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(() => {
        integrationDebounce.delete(guild.id);
        void this.postIntegrationChange(guild.id);
      }, 2_500);
      timer.unref();
      integrationDebounce.set(guild.id, timer);
    } catch (error) {
      loggers.bot.debug("guildIntegrationsUpdate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async postIntegrationChange(guildId: string): Promise<void> {
    try {
      const resolvedGuild =
        bot.guilds.cache.get(guildId) ??
        (await bot.guilds.fetch(guildId).catch(() => null));
      if (!resolvedGuild) {
        return;
      }

      const create = await discordAuditResolver.resolve(
        resolvedGuild,
        AuditLogEvent.IntegrationCreate,
        { maxAgeMs: 8_000 },
      );
      const update = await discordAuditResolver.resolve(
        resolvedGuild,
        AuditLogEvent.IntegrationUpdate,
        { maxAgeMs: 8_000 },
      );
      const del = await discordAuditResolver.resolve(
        resolvedGuild,
        AuditLogEvent.IntegrationDelete,
        { maxAgeMs: 8_000 },
      );

      const candidates = [
        { kind: "Created" as const, audit: create, severity: "success" as const },
        { kind: "Updated" as const, audit: update, severity: "info" as const },
        { kind: "Deleted" as const, audit: del, severity: "danger" as const },
      ].filter((c) => c.audit.entry);

      candidates.sort(
        (a, b) =>
          (b.audit.entry?.createdTimestamp ?? 0) -
          (a.audit.entry?.createdTimestamp ?? 0),
      );

      const best = candidates[0];
      const title = best
        ? `Integration ${best.kind}`
        : "Integrations Updated";
      const severity = best?.severity ?? "info";
      const audit = best?.audit;
      const target = audit?.entry?.target as { name?: string; id?: string } | null;

      const fields: { name: string; value: string; inline?: boolean }[] = [];
      if (target?.name || target?.id) {
        fields.push({
          name: "Integration",
          value: target.name
            ? `${target.name}${target.id ? ` (\`${target.id}\`)` : ""}`
            : `\`${target.id}\``,
        });
      }
      if (audit?.executor) {
        fields.push({
          name: "Executor",
          value: await auditLogManager.formatUser(
            audit.executor.id,
            audit.executor.username,
          ),
          inline: true,
        });
      } else {
        fields.push(unknownExecutorField());
      }
      if (audit?.reason) {
        fields.push({ name: "Reason", value: audit.reason.slice(0, 1024) });
      }

      await auditLogManager.postLog({
        guildId,
        category: "integrations",
        title,
        severity,
        fields:
          fields.length > 0
            ? fields
            : [{ name: "Detail", value: "Integration list changed" }],
        components: claimComponentsIfUnresolved(!!audit?.executor),
        auditEntryId: audit?.entryId,
      });
    } catch (error) {
      loggers.bot.debug("postIntegrationChange failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "applicationCommandPermissionsUpdate" })
  async onCommandPermissions([
    data,
  ]: ArgsOf<"applicationCommandPermissionsUpdate">): Promise<void> {
    try {
      if (!data.guildId) {
        return;
      }

      const guild =
        bot.guilds.cache.get(data.guildId) ??
        (await bot.guilds.fetch(data.guildId).catch(() => null));

      let executorFields: { name: string; value: string; inline?: boolean }[] =
        [];
      let components;
      let auditEntryId: string | null = null;
      if (guild) {
        const audit = await discordAuditResolver.resolve(
          guild,
          AuditLogEvent.ApplicationCommandPermissionUpdate,
          { maxAgeMs: 12_000 },
        );
        auditEntryId = audit.entryId;
        if (audit.executor) {
          executorFields = [
            {
              name: "Executor",
              value: await auditLogManager.formatUser(
                audit.executor.id,
                audit.executor.username,
              ),
              inline: true,
            },
          ];
        } else {
          executorFields = [unknownExecutorField()];
          components = claimComponentsIfUnresolved(false);
        }
      }

      await auditLogManager.postLog({
        guildId: data.guildId,
        category: "integrations",
        title: "App Command Permissions Updated",
        severity: "info",
        fields: [
          {
            name: "Application",
            value: `\`${data.applicationId}\``,
            inline: true,
          },
          {
            name: "Command",
            value: data.id ? `\`${data.id}\`` : "*all / unknown*",
            inline: true,
          },
          ...executorFields,
        ],
        components,
        auditEntryId,
      });
    } catch (error) {
      loggers.bot.debug("applicationCommandPermissionsUpdate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
