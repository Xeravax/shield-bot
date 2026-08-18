import { ArgsOf, Discord, On } from "discordx";
import {
  AuditLogEvent,
  EmbedBuilder,
  GuildMember,
  GuildMemberFlags,
} from "discord.js";
import {
  auditLogManager,
  auditLogSeen,
  discordAuditResolver,
  modCaseManager,
  prisma,
} from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import { LOGGING_COLORS } from "../../../managers/logging/index.js";
import {
  claimComponentsIfUnresolved,
  unknownExecutorField,
} from "../../../managers/logging/auditExecutorFields.js";
import {
  diffRolesFromBaseline,
  queueMemberRoleChange,
} from "../../../managers/logging/roleChangeCoalesce.js";
import { postStaffActionLog } from "../../../managers/logging/reasonPrompt.js";

@Discord()
export class LoggingMemberEvents {
  @On({ event: "guildMemberAdd" })
  async onAdd([member]: ArgsOf<"guildMemberAdd">): Promise<void> {
    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: member.guild.id },
        select: { welcomeChannelId: true },
      });

      if (settings?.welcomeChannelId) {
        const channel = await member.guild.channels
          .fetch(settings.welcomeChannelId)
          .catch(() => null);
        if (channel?.isTextBased()) {
          const embed = new EmbedBuilder()
            .setColor(LOGGING_COLORS.success)
            .setTitle(member.user.bot ? "Bot Added" : "Member Joined")
            .setDescription(`Welcome ${member}!`)
            .addFields(
              {
                name: "User",
                value: await auditLogManager.formatUser(member.id, member.user.username),
              },
              {
                name: "Account created",
                value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
                inline: true,
              },
              {
                name: "Member count",
                value: String(member.guild.memberCount),
                inline: true,
              },
            )
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp(new Date());
          await channel.send({ embeds: [embed] }).catch(() => undefined);
        }
      }

      if (member.user.bot) {
        await auditLogManager.postLog({
          guildId: member.guild.id,
          category: "members",
          title: "Bot Added",
          severity: "warn",
          fields: [
            {
              name: "Bot",
              value: await auditLogManager.formatUser(member.id, member.user.username),
            },
            {
              name: "Account created",
              value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
              inline: true,
            },
            {
              name: "Member count",
              value: String(member.guild.memberCount),
              inline: true,
            },
          ],
          thumbnailUrl: member.user.displayAvatarURL(),
        });
      } else {
        await auditLogManager.postLog({
          guildId: member.guild.id,
          category: "members",
          title: "Member Joined",
          severity: "success",
          fields: [
            {
              name: "User",
              value: await auditLogManager.formatUser(member.id, member.user.username),
            },
            {
              name: "Account created",
              value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
              inline: true,
            },
            {
              name: "Member count",
              value: String(member.guild.memberCount),
              inline: true,
            },
          ],
          thumbnailUrl: member.user.displayAvatarURL(),
        });
      }
    } catch (error) {
      loggers.bot.debug("guildMemberAdd logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "guildMemberRemove" })
  async onRemove([member]: ArgsOf<"guildMemberRemove">): Promise<void> {
    try {
      const audit = await discordAuditResolver.resolve(
        member.guild,
        AuditLogEvent.MemberKick,
        { targetId: member.id, maxAgeMs: 10_000 },
      );

      // Kick is handled more specifically by moderation gateway when our command runs;
      // still log leaves (and kicks attributed via audit) to Members.
      const fields = [
        {
          name: "User",
          value: await auditLogManager.formatUser(
            member.id,
            member.user?.username ?? null,
          ),
        },
        {
          name: "Joined",
          value: member.joinedTimestamp
            ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
            : "*unknown*",
          inline: true,
        },
      ];
      if (audit.executor) {
        fields.push({
          name: "Kicked by",
          value: await auditLogManager.formatUser(
            audit.executor.id,
            audit.executor.username,
          ),
          inline: true,
        });
      }

      const isStaffKick =
        !!audit.executor &&
        !audit.executor.bot &&
        !member.user?.bot &&
        audit.executor.id !== member.client.user?.id;

      if (isStaffKick) {
        await postStaffActionLog(auditLogManager, {
          guildId: member.guild.id,
          category: "members",
          title: "Member Kicked",
          severity: "danger",
          fields,
          executorId: audit.executor!.id,
          reason: audit.reason,
          executorIsBot: false,
          auditEntryId: audit.entryId,
        });
      } else {
        await auditLogManager.postLog({
          guildId: member.guild.id,
          category: "members",
          title: member.user?.bot
            ? "Bot Removed"
            : audit.executor
              ? "Member Kicked"
              : "Member Left",
          severity: member.user?.bot ? "warn" : "danger",
          fields,
          thumbnailUrl: member.user?.displayAvatarURL(),
          auditEntryId: audit.entryId,
        });
      }

      // UI / external kicks → moderation case (slash kick suppresses + bot executor).
      if (
        isStaffKick &&
        !modCaseManager.shouldSuppressGatewayCase(
          member.guild.id,
          "KICK",
          member.id,
        )
      ) {
        await modCaseManager.createCase({
          guildId: member.guild.id,
          type: "KICK",
          targetId: member.id,
          moderatorId: audit.executor!.id,
          reason: audit.reason ?? "Kick (gateway)",
          active: false,
        });
      }
    } catch (error) {
      loggers.bot.debug("guildMemberRemove logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "guildMemberUpdate" })
  async onUpdate([oldMember, newMember]: ArgsOf<"guildMemberUpdate">): Promise<void> {
    try {
      if (!oldMember.partial) {
        await this.logRoleDiff(oldMember, newMember);
        await this.logProfileDiff(oldMember, newMember);
        await this.logBoostDiff(oldMember, newMember);
        await this.logMembershipFlagsDiff(oldMember, newMember);
      }
      await this.logTimeoutDiff(oldMember, newMember);
    } catch (error) {
      loggers.bot.debug("guildMemberUpdate logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "userUpdate" })
  async onUserUpdate([oldUser, newUser]: ArgsOf<"userUpdate">): Promise<void> {
    try {
      // Avatar/banner-only updates are extremely noisy; only log identity changes.
      const usernameChanged = oldUser.username !== newUser.username;
      const globalNameChanged = oldUser.globalName !== newUser.globalName;
      if (!usernameChanged && !globalNameChanged) {
        return;
      }

      const changes: string[] = [];
      if (usernameChanged) {
        changes.push(`Username: \`${oldUser.username}\` → \`${newUser.username}\``);
      }
      if (globalNameChanged) {
        changes.push(
          `Display name: \`${oldUser.globalName ?? "none"}\` → \`${newUser.globalName ?? "none"}\``,
        );
      }

      for (const guild of newUser.client.guilds.cache.values()) {
        const member = guild.members.cache.get(newUser.id);
        if (!member) {
          continue;
        }
        await auditLogManager.postLog({
          guildId: guild.id,
          category: "members",
          title: "User Profile Updated",
          severity: "info",
          fields: [
            {
              name: "User",
              value: await auditLogManager.formatUser(newUser.id, newUser.username),
            },
            { name: "Changes", value: changes.join("\n") },
          ],
          thumbnailUrl: newUser.displayAvatarURL(),
        });
      }
    } catch (error) {
      loggers.bot.debug("userUpdate logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async logRoleDiff(
    oldMember: GuildMember | import("discord.js").PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
    if (added.size === 0 && removed.size === 0) {
      return;
    }

    queueMemberRoleChange(oldMember, newMember, (guildId, member, baseline, auditEntryIds) =>
      this.flushRoleDiff(guildId, member, baseline, auditEntryIds),
    );
  }

  private async flushRoleDiff(
    guildId: string,
    member: GuildMember,
    baselineRoleIds: Set<string>,
    auditEntryIds: string[],
  ): Promise<void> {
    try {
      const diff = diffRolesFromBaseline(member, baselineRoleIds);
      if (!diff.changed) {
        auditLogSeen.consumeMany(guildId, auditEntryIds);
        return;
      }

      const audit = await discordAuditResolver.resolve(
        member.guild,
        AuditLogEvent.MemberRoleUpdate,
        { targetId: member.id, maxAgeMs: 15_000 },
      );

      const executorId = audit.executor?.id;
      const executorIsBot = !!audit.executor?.bot;

      const fields = [
        {
          name: "Member",
          value: await auditLogManager.formatUser(member.id, member.user.username),
        },
        {
          name: "Changes",
          value: diff.changesText,
        },
      ];

      if (audit.executor) {
        fields.push({
          name: "Executor",
          value: await auditLogManager.formatUser(audit.executor.id, audit.executor.username),
        });
      } else {
        fields.push(unknownExecutorField());
      }

      const message = await postStaffActionLog(auditLogManager, {
        guildId,
        category: "roles",
        title: "Member Roles Updated",
        severity: "info",
        fields,
        executorId,
        reason: audit.reason,
        executorIsBot,
        skipReasonPrompt: executorIsBot || !executorId,
        claimIfUnresolved: !audit.executor,
        auditEntryId: audit.entryId,
      });
      if (message) {
        auditLogSeen.consumeMany(guildId, [...auditEntryIds, audit.entryId]);
      }
    } catch (error) {
      loggers.bot.debug("flushRoleDiff logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async logProfileDiff(
    oldMember: GuildMember | import("discord.js").PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    // Skip server-avatar-only noise; nickname changes are still logged.
    if (oldMember.nickname === newMember.nickname) {
      return;
    }
    const changes: string[] = [
      `Nickname: \`${oldMember.nickname ?? "none"}\` → \`${newMember.nickname ?? "none"}\``,
    ];

    const audit = await discordAuditResolver.resolve(
      newMember.guild,
      AuditLogEvent.MemberUpdate,
      { targetId: newMember.id },
    );

    await auditLogManager.postLog({
      guildId: newMember.guild.id,
      category: "members",
      title: "Member Updated",
      severity: "info",
      fields: [
        {
          name: "Member",
          value: await auditLogManager.formatUser(newMember.id, newMember.user.username),
        },
        { name: "Changes", value: changes.join("\n") },
        ...(audit.executor
          ? [
              {
                name: "Executor",
                value: await auditLogManager.formatUser(
                  audit.executor.id,
                  audit.executor.username,
                ),
              },
            ]
          : [unknownExecutorField()]),
      ],
      components: claimComponentsIfUnresolved(!!audit.executor),
      thumbnailUrl: newMember.displayAvatarURL(),
      auditEntryId: audit.entryId,
    });
  }

  private async logBoostDiff(
    oldMember: GuildMember | import("discord.js").PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    const oldBoost = oldMember.premiumSinceTimestamp;
    const newBoost = newMember.premiumSinceTimestamp;
    if (oldBoost === newBoost) {
      return;
    }
    const gained = !oldBoost && !!newBoost;
    await auditLogManager.postLog({
      guildId: newMember.guild.id,
      category: "members",
      title: gained ? "Server Boost Gained" : "Server Boost Lost",
      severity: gained ? "success" : "warn",
      fields: [
        {
          name: "Member",
          value: await auditLogManager.formatUser(newMember.id, newMember.user.username),
        },
      ],
      thumbnailUrl: newMember.displayAvatarURL(),
    });
  }

  private async logMembershipFlagsDiff(
    oldMember: GuildMember | import("discord.js").PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    const memberLine = await auditLogManager.formatUser(
      newMember.id,
      newMember.user.username,
    );

    // Membership screening: pending true → false without bypass flag change
    if (oldMember.pending && !newMember.pending) {
      const bypassedNow = newMember.flags.has(GuildMemberFlags.BypassesVerification);
      const bypassedBefore =
        "flags" in oldMember && oldMember.flags
          ? oldMember.flags.has(GuildMemberFlags.BypassesVerification)
          : false;
      if (!bypassedNow || bypassedBefore) {
        await auditLogManager.postLog({
          guildId: newMember.guild.id,
          category: "members",
          title: "Membership Screening Completed",
          severity: "success",
          fields: [{ name: "Member", value: memberLine }],
          thumbnailUrl: newMember.displayAvatarURL(),
        });
      }
    }

    const oldFlags =
      "flags" in oldMember && oldMember.flags ? oldMember.flags : null;
    if (!oldFlags) {
      return;
    }

    const gainedBypass =
      !oldFlags.has(GuildMemberFlags.BypassesVerification) &&
      newMember.flags.has(GuildMemberFlags.BypassesVerification);
    if (gainedBypass) {
      const audit = await discordAuditResolver.resolve(
        newMember.guild,
        AuditLogEvent.MemberUpdate,
        { targetId: newMember.id },
      );
      const fields = [
        { name: "Member", value: memberLine },
        ...(audit.executor
          ? [
              {
                name: "Executor",
                value: await auditLogManager.formatUser(
                  audit.executor.id,
                  audit.executor.username,
                ),
              },
            ]
          : [unknownExecutorField()]),
      ];
      await postStaffActionLog(auditLogManager, {
        guildId: newMember.guild.id,
        category: "members",
        title: "Verification Bypassed",
        severity: "warn",
        fields,
        executorId: audit.executor?.id,
        reason: audit.reason,
        executorIsBot: !!audit.executor?.bot,
        claimIfUnresolved: !audit.executor,
        auditEntryId: audit.entryId,
      });
    }

    const startedOnboarding =
      !oldFlags.has(GuildMemberFlags.StartedOnboarding) &&
      newMember.flags.has(GuildMemberFlags.StartedOnboarding);
    if (startedOnboarding) {
      await auditLogManager.postLog({
        guildId: newMember.guild.id,
        category: "members",
        title: "Onboarding Started",
        severity: "info",
        fields: [{ name: "Member", value: memberLine }],
        thumbnailUrl: newMember.displayAvatarURL(),
      });
    }

    const completedOnboarding =
      !oldFlags.has(GuildMemberFlags.CompletedOnboarding) &&
      newMember.flags.has(GuildMemberFlags.CompletedOnboarding);
    if (completedOnboarding) {
      await auditLogManager.postLog({
        guildId: newMember.guild.id,
        category: "members",
        title: "Onboarding Completed",
        severity: "success",
        fields: [{ name: "Member", value: memberLine }],
        thumbnailUrl: newMember.displayAvatarURL(),
      });
    }
  }

  private async logTimeoutDiff(
    oldMember: GuildMember | import("discord.js").PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
    const newTimeout = newMember.communicationDisabledUntilTimestamp;
    if (oldTimeout === newTimeout) {
      return;
    }

    // Command-originated timeouts create cases themselves; still attribute gateway timeouts.
    const now = Date.now();
    const applied = !!newTimeout && newTimeout > now;
    const removed = !!oldTimeout && (!newTimeout || newTimeout <= now);

    if (!applied && !removed) {
      return;
    }

    const audit = await discordAuditResolver.resolve(
      newMember.guild,
      AuditLogEvent.MemberUpdate,
      { targetId: newMember.id },
    );

    // Skip if our bot just did it (mod commands set executor = bot within window)
    if (audit.executor?.id && audit.executor.id === newMember.client.user?.id) {
      return;
    }

    if (applied && newTimeout) {
      await postStaffActionLog(auditLogManager, {
        guildId: newMember.guild.id,
        category: "moderation",
        title: "Member Timed Out",
        severity: "warn",
        fields: [
          {
            name: "Member",
            value: await auditLogManager.formatUser(
              newMember.id,
              newMember.user.username,
            ),
          },
          ...(audit.executor
            ? [
                {
                  name: "Executor",
                  value: await auditLogManager.formatUser(
                    audit.executor.id,
                    audit.executor.username,
                  ),
                },
              ]
            : [unknownExecutorField()]),
          {
            name: "Expires",
            value: `<t:${Math.floor(newTimeout / 1000)}:F>`,
          },
        ],
        executorId: audit.executor?.id,
        reason: audit.reason,
        executorIsBot: !!audit.executor?.bot,
        claimIfUnresolved: !audit.executor,
        auditEntryId: audit.entryId,
      });

      await modCaseManager.createCase({
        guildId: newMember.guild.id,
        type: "TIMEOUT",
        targetId: newMember.id,
        moderatorId: audit.executor?.id ?? newMember.client.user?.id ?? newMember.id,
        reason: audit.reason ?? "Timeout (gateway)",
        expiresAt: new Date(newTimeout),
      });
    } else if (removed) {
      await postStaffActionLog(auditLogManager, {
        guildId: newMember.guild.id,
        category: "moderation",
        title: "Timeout Removed",
        severity: "success",
        fields: [
          {
            name: "Member",
            value: await auditLogManager.formatUser(
              newMember.id,
              newMember.user.username,
            ),
          },
          ...(audit.executor
            ? [
                {
                  name: "Executor",
                  value: await auditLogManager.formatUser(
                    audit.executor.id,
                    audit.executor.username,
                  ),
                },
              ]
            : [unknownExecutorField()]),
        ],
        executorId: audit.executor?.id,
        reason: audit.reason,
        executorIsBot: !!audit.executor?.bot,
        claimIfUnresolved: !audit.executor,
        auditEntryId: audit.entryId,
      });

      await modCaseManager.createCase({
        guildId: newMember.guild.id,
        type: "UNTIMEOUT",
        targetId: newMember.id,
        moderatorId: audit.executor?.id ?? newMember.client.user?.id ?? newMember.id,
        reason: audit.reason ?? "Timeout removed (gateway)",
        active: false,
      });
    }
  }
}
