import { ArgsOf, Discord, On } from "discordx";
import {
  AuditLogEvent,
  EmbedBuilder,
  GuildMember,
} from "discord.js";
import {
  auditLogManager,
  discordAuditResolver,
  modCaseManager,
  prisma,
} from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import { LOGGING_COLORS } from "../../../managers/logging/index.js";

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
                value: auditLogManager.formatUser(member.id, member.user.tag),
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
              value: auditLogManager.formatUser(member.id, member.user.tag),
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
          value: auditLogManager.formatUser(
            member.id,
            member.user?.tag ?? null,
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
          value: auditLogManager.formatUser(
            audit.executor.id,
            audit.executor.tag,
          ),
          inline: true,
        });
        if (audit.reason) {
          fields.push({ name: "Reason", value: audit.reason.slice(0, 1024) });
        }
      }

      await auditLogManager.postLog({
        guildId: member.guild.id,
        category: "members",
        title: member.user?.bot
          ? "Bot Removed"
          : audit.executor
            ? "Member Kicked"
            : "Member Left",
        severity: audit.executor ? "danger" : "warn",
        fields,
        thumbnailUrl: member.user?.displayAvatarURL(),
      });
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
      if (
        oldUser.avatar === newUser.avatar &&
        oldUser.banner === newUser.banner &&
        oldUser.username === newUser.username &&
        oldUser.globalName === newUser.globalName
      ) {
        return;
      }

      for (const guild of newUser.client.guilds.cache.values()) {
        const member = guild.members.cache.get(newUser.id);
        if (!member) {
          continue;
        }
        const changes: string[] = [];
        if (oldUser.username !== newUser.username) {
          changes.push(`Username: \`${oldUser.username}\` → \`${newUser.username}\``);
        }
        if (oldUser.globalName !== newUser.globalName) {
          changes.push(
            `Display name: \`${oldUser.globalName ?? "none"}\` → \`${newUser.globalName ?? "none"}\``,
          );
        }
        if (oldUser.avatar !== newUser.avatar) {
          changes.push("Avatar changed");
        }
        if (oldUser.banner !== newUser.banner) {
          changes.push("Banner changed");
        }
        if (changes.length === 0) {
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
              value: auditLogManager.formatUser(newUser.id, newUser.tag),
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

    const audit = await discordAuditResolver.resolve(
      newMember.guild,
      AuditLogEvent.MemberRoleUpdate,
      { targetId: newMember.id },
    );

    const fields = [
      {
        name: "Member",
        value: auditLogManager.formatUser(newMember.id, newMember.user.tag),
      },
    ];
    if (added.size) {
      fields.push({
        name: "Added",
        value: [...added.values()].map((r) => `${r}`).join(", ").slice(0, 1024),
      });
    }
    if (removed.size) {
      fields.push({
        name: "Removed",
        value: [...removed.values()].map((r) => `${r.name} (\`${r.id}\`)`).join(", ").slice(0, 1024),
      });
    }
    if (audit.executor) {
      fields.push({
        name: "Executor",
        value: auditLogManager.formatUser(audit.executor.id, audit.executor.tag),
      });
    }

    await auditLogManager.postLog({
      guildId: newMember.guild.id,
      category: "roles",
      title: "Member Roles Updated",
      severity: "info",
      fields,
    });
  }

  private async logProfileDiff(
    oldMember: GuildMember | import("discord.js").PartialGuildMember,
    newMember: GuildMember,
  ): Promise<void> {
    const changes: string[] = [];
    if (oldMember.nickname !== newMember.nickname) {
      changes.push(
        `Nickname: \`${oldMember.nickname ?? "none"}\` → \`${newMember.nickname ?? "none"}\``,
      );
    }
    if (oldMember.avatar !== newMember.avatar) {
      changes.push("Server avatar changed");
    }
    if (changes.length === 0) {
      return;
    }

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
          value: auditLogManager.formatUser(newMember.id, newMember.user.tag),
        },
        { name: "Changes", value: changes.join("\n") },
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
          : []),
      ],
      thumbnailUrl: newMember.displayAvatarURL(),
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
          value: auditLogManager.formatUser(newMember.id, newMember.user.tag),
        },
      ],
      thumbnailUrl: newMember.displayAvatarURL(),
    });
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
      await modCaseManager.createCase({
        guildId: newMember.guild.id,
        type: "TIMEOUT",
        targetId: newMember.id,
        moderatorId: audit.executor?.id ?? newMember.client.user?.id ?? newMember.id,
        reason: audit.reason ?? "Timeout (gateway)",
        expiresAt: new Date(newTimeout),
      });
    } else if (removed) {
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
