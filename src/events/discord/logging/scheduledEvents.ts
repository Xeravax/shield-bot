import { ArgsOf, Discord, On } from "discordx";
import { AuditLogEvent, GuildScheduledEventStatus } from "discord.js";
import { auditLogManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import { auditExecutorFields } from "../../../managers/logging/index.js";

function statusLabel(status: GuildScheduledEventStatus | null | undefined): string {
  if (status == null) {
    return "*unknown*";
  }
  return GuildScheduledEventStatus[status] ?? String(status);
}

function eventFields(event: {
  id: string;
  name: string;
  description: string | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  channelId: string | null;
  status: GuildScheduledEventStatus;
  entityType: number;
  userCount: number | null;
}): { name: string; value: string; inline?: boolean }[] {
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Name", value: event.name.slice(0, 1024) },
    { name: "Status", value: statusLabel(event.status), inline: true },
    {
      name: "Starts",
      value: event.scheduledStartAt
        ? `<t:${Math.floor(event.scheduledStartAt.getTime() / 1000)}:F>`
        : "*unknown*",
      inline: true,
    },
  ];
  if (event.scheduledEndAt) {
    fields.push({
      name: "Ends",
      value: `<t:${Math.floor(event.scheduledEndAt.getTime() / 1000)}:F>`,
      inline: true,
    });
  }
  if (event.channelId) {
    fields.push({
      name: "Channel",
      value: auditLogManager.formatChannel(event.channelId),
    });
  }
  if (event.description) {
    fields.push({
      name: "Description",
      value: auditLogManager.truncate(event.description),
    });
  }
  fields.push({
    name: "Event ID",
    value: `\`${event.id}\``,
    inline: true,
  });
  return fields;
}

@Discord()
export class LoggingScheduledEventEvents {
  @On({ event: "guildScheduledEventCreate" })
  async onCreate([event]: ArgsOf<"guildScheduledEventCreate">): Promise<void> {
    try {
      if (!event.guild) {
        return;
      }
      const { fields: extra, components } = await auditExecutorFields(
        event.guild,
        AuditLogEvent.GuildScheduledEventCreate,
        event.id,
      );
      await auditLogManager.postLog({
        guildId: event.guild.id,
        category: "events",
        title: "Scheduled Event Created",
        severity: "success",
        fields: [...eventFields(event), ...extra],
        components,
        imageUrl: event.coverImageURL({ size: 512 }),
      });
    } catch (error) {
      loggers.bot.debug("guildScheduledEventCreate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "guildScheduledEventUpdate" })
  async onUpdate([
    oldEvent,
    newEvent,
  ]: ArgsOf<"guildScheduledEventUpdate">): Promise<void> {
    try {
      if (!newEvent.guild || !oldEvent) {
        return;
      }

      const changes: string[] = [];
      if (oldEvent.name !== newEvent.name) {
        changes.push(`Name: \`${oldEvent.name}\` → \`${newEvent.name}\``);
      }
      if (oldEvent.description !== newEvent.description) {
        changes.push("Description changed");
      }
      if (oldEvent.status !== newEvent.status) {
        changes.push(
          `Status: ${statusLabel(oldEvent.status)} → ${statusLabel(newEvent.status)}`,
        );
      }
      if (
        oldEvent.scheduledStartTimestamp !== newEvent.scheduledStartTimestamp
      ) {
        changes.push("Start time changed");
      }
      if (oldEvent.scheduledEndTimestamp !== newEvent.scheduledEndTimestamp) {
        changes.push("End time changed");
      }
      if (oldEvent.channelId !== newEvent.channelId) {
        changes.push(
          `Channel: ${oldEvent.channelId ?? "none"} → ${newEvent.channelId ?? "none"}`,
        );
      }
      if (oldEvent.image !== newEvent.image) {
        changes.push("Cover image changed");
      }
      if (changes.length === 0) {
        return;
      }

      const { fields: extra, components } = await auditExecutorFields(
        newEvent.guild,
        AuditLogEvent.GuildScheduledEventUpdate,
        newEvent.id,
      );
      await auditLogManager.postLog({
        guildId: newEvent.guild.id,
        category: "events",
        title: "Scheduled Event Updated",
        severity: "info",
        fields: [
          ...eventFields(newEvent),
          { name: "Changes", value: changes.join("\n").slice(0, 1024) },
          ...extra,
        ],
        components,
        imageUrl: newEvent.coverImageURL({ size: 512 }),
      });
    } catch (error) {
      loggers.bot.debug("guildScheduledEventUpdate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "guildScheduledEventDelete" })
  async onDelete([event]: ArgsOf<"guildScheduledEventDelete">): Promise<void> {
    try {
      if (!event.guild) {
        return;
      }
      const { fields: extra, components } = await auditExecutorFields(
        event.guild,
        AuditLogEvent.GuildScheduledEventDelete,
        event.id,
      );
      await auditLogManager.postLog({
        guildId: event.guild.id,
        category: "events",
        title: "Scheduled Event Deleted",
        severity: "danger",
        fields: [
          {
            name: "Name",
            value: (event.name ?? "Unknown event").slice(0, 1024),
          },
          {
            name: "Event ID",
            value: `\`${event.id}\``,
            inline: true,
          },
          ...extra,
        ],
        components,
      });
    } catch (error) {
      loggers.bot.debug("guildScheduledEventDelete log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
