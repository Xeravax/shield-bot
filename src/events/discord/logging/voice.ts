import { ArgsOf, Discord, On } from "discordx";
import { AuditLogEvent, type Guild } from "discord.js";
import { auditLogManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import { resolveAuditExecutor } from "../../../managers/logging/auditExecutorFields.js";
import { postStaffActionLog } from "../../../managers/logging/reasonPrompt.js";
import { unknownExecutorField } from "../../../managers/logging/auditExecutorFields.js";

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

      // Server mute / deaf (moderator-attributed)
      if (oldState.serverMute !== newState.serverMute) {
        await this.logStaffVoiceAction(
          guild,
          member.id,
          newState.serverMute ? "Server Mute" : "Server Unmute",
          fieldsBase,
          newState.channelId ?? oldState.channelId,
        );
      }
      if (oldState.serverDeaf !== newState.serverDeaf) {
        await this.logStaffVoiceAction(
          guild,
          member.id,
          newState.serverDeaf ? "Server Deafen" : "Server Undeafen",
          fieldsBase,
          newState.channelId ?? oldState.channelId,
        );
      }

      // Self mute / deaf
      if (oldState.selfMute !== newState.selfMute) {
        await auditLogManager.postLog({
          guildId: guild.id,
          category: "voice",
          title: newState.selfMute ? "Self Mute" : "Self Unmute",
          severity: "info",
          fields: fieldsBase,
          sourceChannelId: newState.channelId ?? oldState.channelId,
        });
      }
      if (oldState.selfDeaf !== newState.selfDeaf) {
        await auditLogManager.postLog({
          guildId: guild.id,
          category: "voice",
          title: newState.selfDeaf ? "Self Deafen" : "Self Undeafen",
          severity: "info",
          fields: fieldsBase,
          sourceChannelId: newState.channelId ?? oldState.channelId,
        });
      }

      // Stream / camera
      if (oldState.streaming !== newState.streaming) {
        await auditLogManager.postLog({
          guildId: guild.id,
          category: "voice",
          title: newState.streaming ? "Stream Started" : "Stream Ended",
          severity: "info",
          fields: [
            ...fieldsBase,
            {
              name: "Channel",
              value: auditLogManager.formatChannel(
                (newState.channelId ?? oldState.channelId)!,
              ),
            },
          ],
          sourceChannelId: newState.channelId ?? oldState.channelId,
        });
      }
      if (oldState.selfVideo !== newState.selfVideo) {
        await auditLogManager.postLog({
          guildId: guild.id,
          category: "voice",
          title: newState.selfVideo ? "Camera On" : "Camera Off",
          severity: "info",
          fields: [
            ...fieldsBase,
            {
              name: "Channel",
              value: auditLogManager.formatChannel(
                (newState.channelId ?? oldState.channelId)!,
              ),
            },
          ],
          sourceChannelId: newState.channelId ?? oldState.channelId,
        });
      }

      // Stage suppress / request-to-speak
      if (oldState.suppress !== newState.suppress) {
        await auditLogManager.postLog({
          guildId: guild.id,
          category: "voice",
          title: newState.suppress ? "Stage Suppressed" : "Stage Unsuppressed",
          severity: "info",
          fields: fieldsBase,
          sourceChannelId: newState.channelId ?? oldState.channelId,
        });
      }
      if (
        oldState.requestToSpeakTimestamp !== newState.requestToSpeakTimestamp
      ) {
        await auditLogManager.postLog({
          guildId: guild.id,
          category: "voice",
          title: newState.requestToSpeakTimestamp
            ? "Request to Speak"
            : "Request to Speak Cleared",
          severity: "info",
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

  private async logStaffVoiceAction(
    guild: Guild,
    targetId: string,
    title: string,
    fieldsBase: { name: string; value: string }[],
    sourceChannelId: string | null,
  ): Promise<void> {
    const { audit, fields: extra } = await resolveAuditExecutor(
      guild,
      AuditLogEvent.MemberUpdate,
      {
        targetId,
        maxAgeMs: 8_000,
        claimIfUnresolved: true,
      },
    );

    const executorId = audit.executor?.id;
    const executorIsBot = !!audit.executor?.bot;

    await postStaffActionLog(auditLogManager, {
      guildId: guild.id,
      category: "voice",
      title,
      severity: "warn",
      fields: [
        ...fieldsBase,
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
        // Drop duplicate executor from resolveAuditExecutor extra if present
        ...extra.filter((f) => f.name !== "Executor" && f.name !== "Reason"),
      ],
      executorId,
      reason: audit.reason,
      executorIsBot,
      skipReasonPrompt: executorIsBot || !executorId,
      claimIfUnresolved: !audit.executor,
      sourceChannelId,
    });
  }
}
