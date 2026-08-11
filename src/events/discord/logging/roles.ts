import { ArgsOf, Discord, On } from "discordx";
import { AuditLogEvent } from "discord.js";
import { auditLogManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import { auditExecutorFields } from "../../../managers/logging/index.js";

@Discord()
export class LoggingRoleEvents {
  @On({ event: "roleCreate" })
  async onCreate([role]: ArgsOf<"roleCreate">): Promise<void> {
    try {
      const { fields: extra, components } = await auditExecutorFields(
        role.guild,
        AuditLogEvent.RoleCreate,
        role.id,
      );
      await auditLogManager.postLog({
        guildId: role.guild.id,
        category: "roles",
        title: "Role Created",
        severity: "success",
        fields: [
          {
            name: "Role",
            value: `${role.name} (\`${role.id}\`)`,
          },
          ...extra,
        ],
        components,
      });
    } catch (error) {
      loggers.bot.debug("roleCreate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "roleDelete" })
  async onDelete([role]: ArgsOf<"roleDelete">): Promise<void> {
    try {
      const { fields: extra, components } = await auditExecutorFields(
        role.guild,
        AuditLogEvent.RoleDelete,
        role.id,
      );
      await auditLogManager.postLog({
        guildId: role.guild.id,
        category: "roles",
        title: "Role Deleted",
        severity: "danger",
        fields: [
          {
            name: "Role",
            value: `${role.name} (\`${role.id}\`)`,
          },
          ...extra,
        ],
        components,
      });
    } catch (error) {
      loggers.bot.debug("roleDelete log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "roleUpdate" })
  async onUpdate([oldRole, newRole]: ArgsOf<"roleUpdate">): Promise<void> {
    try {
      const changes: string[] = [];
      if (oldRole.name !== newRole.name) {
        changes.push(`Name: \`${oldRole.name}\` → \`${newRole.name}\``);
      }
      if (oldRole.hexColor !== newRole.hexColor) {
        changes.push(`Color: ${oldRole.hexColor} → ${newRole.hexColor}`);
      }
      if (oldRole.hoist !== newRole.hoist) {
        changes.push(`Hoist: ${oldRole.hoist} → ${newRole.hoist}`);
      }
      if (oldRole.mentionable !== newRole.mentionable) {
        changes.push(`Mentionable: ${oldRole.mentionable} → ${newRole.mentionable}`);
      }
      if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        const added = newRole.permissions
          .toArray()
          .filter((p) => !oldRole.permissions.has(p));
        const removed = oldRole.permissions
          .toArray()
          .filter((p) => !newRole.permissions.has(p));
        if (added.length) {
          changes.push(`Perms added: ${added.join(", ")}`);
        }
        if (removed.length) {
          changes.push(`Perms removed: ${removed.join(", ")}`);
        }
      }
      if (changes.length === 0) {
        return;
      }

      const { fields: extra, components } = await auditExecutorFields(
        newRole.guild,
        AuditLogEvent.RoleUpdate,
        newRole.id,
      );
      await auditLogManager.postLog({
        guildId: newRole.guild.id,
        category: "roles",
        title: "Role Updated",
        severity: "info",
        fields: [
          {
            name: "Role",
            value: `${newRole.name} (\`${newRole.id}\`)`,
          },
          { name: "Changes", value: changes.join("\n").slice(0, 1024) },
          ...extra,
        ],
        components,
      });
    } catch (error) {
      loggers.bot.debug("roleUpdate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
