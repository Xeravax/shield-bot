import { ArgsOf, Discord, On } from "discordx";
import { AuditLogEvent } from "discord.js";
import { auditLogManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import { resolveAuditExecutor } from "../../../managers/logging/auditExecutorFields.js";

@Discord()
export class LoggingVoiceEvents {
  @On({ event: "voiceStateUpdate" })
  async onVoice([oldState, newState]: ArgsOf<"voiceStateUpdate">): Promise<void> {
    try {
      const guild = newState.guild;
      const member = newState.member ?? oldState.member;
      if (!member) {
        return;
      }

      const fieldsBase = [
        {
          name: "Member",
          value: auditLogManager.formatUser(member.id, member.user.tag),
        },
      ];

      // Join
      if (!oldState.channelId && newState.channelId) {
        await auditLogManager.postLog({
          guildId: guild.id,
          category: "voice",
          title: "Voice Join",
          severity: "success",
          fields: [
            ...fieldsBase,
            {
              name: "Channel",
              value: auditLogManager.formatChannel(newState.channelId),
            },
          ],
          sourceChannelId: newState.channelId,
        });
        return;
      }

      // Leave
      if (oldState.channelId && !newState.channelId) {
        const { audit, fields: extra, components } = await resolveAuditExecutor(
          guild,
          AuditLogEvent.MemberDisconnect,
          { targetId: member.id, maxAgeMs: 8_000 },
        );
        await auditLogManager.postLog({
          guildId: guild.id,
          category: "voice",
          title: audit.executor ? "Voice Disconnect" : "Voice Leave",
          severity: audit.executor ? "warn" : "info",
          fields: [
            ...fieldsBase,
            {
              name: "Channel",
              value: auditLogManager.formatChannel(oldState.channelId),
            },
            ...extra,
          ],
          components,
          sourceChannelId: oldState.channelId,
        });
        return;
      }

      // Move
      if (
        oldState.channelId &&
        newState.channelId &&
        oldState.channelId !== newState.channelId
      ) {
        const { fields: extra, components } = await resolveAuditExecutor(
          guild,
          AuditLogEvent.MemberMove,
          { targetId: member.id, maxAgeMs: 8_000 },
        );
        await auditLogManager.postLog({
          guildId: guild.id,
          category: "voice",
          title: "Voice Move",
          severity: "info",
          fields: [
            ...fieldsBase,
            {
              name: "From",
              value: auditLogManager.formatChannel(oldState.channelId),
            },
            {
              name: "To",
              value: auditLogManager.formatChannel(newState.channelId),
            },
            ...extra,
          ],
          components,
          sourceChannelId: newState.channelId,
        });
      }

      // Server mute / deaf
      if (oldState.serverMute !== newState.serverMute) {
        await auditLogManager.postLog({
          guildId: guild.id,
          category: "voice",
          title: newState.serverMute ? "Server Mute" : "Server Unmute",
          severity: "warn",
          fields: fieldsBase,
          sourceChannelId: newState.channelId ?? oldState.channelId,
        });
      }
      if (oldState.serverDeaf !== newState.serverDeaf) {
        await auditLogManager.postLog({
          guildId: guild.id,
          category: "voice",
          title: newState.serverDeaf ? "Server Deafen" : "Server Undeafen",
          severity: "warn",
          fields: fieldsBase,
          sourceChannelId: newState.channelId ?? oldState.channelId,
        });
      }
    } catch (error) {
      loggers.bot.debug("voiceStateUpdate logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
