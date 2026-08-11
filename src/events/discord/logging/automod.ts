import { ArgsOf, Discord, On } from "discordx";
import {
  AuditLogEvent,
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
} from "discord.js";
import { auditLogManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import { auditExecutorFields } from "../../../managers/logging/index.js";

function triggerLabel(type: AutoModerationRuleTriggerType): string {
  return AutoModerationRuleTriggerType[type] ?? String(type);
}

function eventTypeLabel(type: AutoModerationRuleEventType): string {
  return AutoModerationRuleEventType[type] ?? String(type);
}

function actionTypeLabel(type: AutoModerationActionType): string {
  return AutoModerationActionType[type] ?? String(type);
}

@Discord()
export class LoggingAutoModEvents {
  @On({ event: "autoModerationRuleCreate" })
  async onRuleCreate([
    rule,
  ]: ArgsOf<"autoModerationRuleCreate">): Promise<void> {
    try {
      const { fields: extra, components } = await auditExecutorFields(
        rule.guild,
        AuditLogEvent.AutoModerationRuleCreate,
        rule.id,
      );
      await auditLogManager.postLog({
        guildId: rule.guild.id,
        category: "automod",
        title: "AutoMod Rule Created",
        severity: "success",
        fields: [
          { name: "Name", value: rule.name },
          {
            name: "Trigger",
            value: triggerLabel(rule.triggerType),
            inline: true,
          },
          {
            name: "Event",
            value: eventTypeLabel(rule.eventType),
            inline: true,
          },
          {
            name: "Enabled",
            value: String(rule.enabled),
            inline: true,
          },
          { name: "Rule ID", value: `\`${rule.id}\``, inline: true },
          ...extra,
        ],
        components,
      });
    } catch (error) {
      loggers.bot.debug("autoModerationRuleCreate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "autoModerationRuleUpdate" })
  async onRuleUpdate([
    oldRule,
    newRule,
  ]: ArgsOf<"autoModerationRuleUpdate">): Promise<void> {
    try {
      if (!oldRule) {
        return;
      }
      const changes: string[] = [];
      if (oldRule.name !== newRule.name) {
        changes.push(`Name: \`${oldRule.name}\` → \`${newRule.name}\``);
      }
      if (oldRule.enabled !== newRule.enabled) {
        changes.push(`Enabled: ${oldRule.enabled} → ${newRule.enabled}`);
      }
      if (oldRule.triggerType !== newRule.triggerType) {
        changes.push(
          `Trigger: ${triggerLabel(oldRule.triggerType)} → ${triggerLabel(newRule.triggerType)}`,
        );
      }
      if (oldRule.eventType !== newRule.eventType) {
        changes.push(
          `Event: ${eventTypeLabel(oldRule.eventType)} → ${eventTypeLabel(newRule.eventType)}`,
        );
      }
      if (changes.length === 0) {
        // Still log generic update when other fields (keywords, actions) change.
        changes.push("Rule configuration changed");
      }

      const { fields: extra, components } = await auditExecutorFields(
        newRule.guild,
        AuditLogEvent.AutoModerationRuleUpdate,
        newRule.id,
      );
      await auditLogManager.postLog({
        guildId: newRule.guild.id,
        category: "automod",
        title: "AutoMod Rule Updated",
        severity: "info",
        fields: [
          { name: "Name", value: newRule.name },
          { name: "Changes", value: changes.join("\n").slice(0, 1024) },
          { name: "Rule ID", value: `\`${newRule.id}\``, inline: true },
          ...extra,
        ],
        components,
      });
    } catch (error) {
      loggers.bot.debug("autoModerationRuleUpdate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "autoModerationRuleDelete" })
  async onRuleDelete([
    rule,
  ]: ArgsOf<"autoModerationRuleDelete">): Promise<void> {
    try {
      const { fields: extra, components } = await auditExecutorFields(
        rule.guild,
        AuditLogEvent.AutoModerationRuleDelete,
        rule.id,
      );
      await auditLogManager.postLog({
        guildId: rule.guild.id,
        category: "automod",
        title: "AutoMod Rule Deleted",
        severity: "danger",
        fields: [
          { name: "Name", value: rule.name },
          {
            name: "Trigger",
            value: triggerLabel(rule.triggerType),
            inline: true,
          },
          { name: "Rule ID", value: `\`${rule.id}\``, inline: true },
          ...extra,
        ],
        components,
      });
    } catch (error) {
      loggers.bot.debug("autoModerationRuleDelete log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "autoModerationActionExecution" })
  async onAction([
    execution,
  ]: ArgsOf<"autoModerationActionExecution">): Promise<void> {
    try {
      const fields: { name: string; value: string; inline?: boolean }[] = [
        {
          name: "User",
          value: auditLogManager.formatUser(execution.userId),
          inline: true,
        },
        {
          name: "Action",
          value: actionTypeLabel(execution.action.type),
          inline: true,
        },
        {
          name: "Rule",
          value: `${execution.ruleTriggerType != null ? triggerLabel(execution.ruleTriggerType) : "rule"} (\`${execution.ruleId}\`)`,
        },
      ];
      if (execution.channelId) {
        fields.push({
          name: "Channel",
          value: auditLogManager.formatChannel(execution.channelId),
          inline: true,
        });
      }
      if (execution.content) {
        fields.push({
          name: "Content",
          value: auditLogManager.truncate(execution.content),
        });
      }
      if (execution.matchedContent) {
        fields.push({
          name: "Matched",
          value: auditLogManager.truncate(execution.matchedContent),
        });
      }
      if (execution.matchedKeyword) {
        fields.push({
          name: "Keyword",
          value: auditLogManager.truncate(execution.matchedKeyword),
          inline: true,
        });
      }

      await auditLogManager.postLog({
        guildId: execution.guild.id,
        category: "automod",
        title: "AutoMod Action",
        severity: "warn",
        fields,
        sourceChannelId: execution.channelId,
      });
    } catch (error) {
      loggers.bot.debug("autoModerationActionExecution log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
