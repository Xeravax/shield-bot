import { Discord, Guard, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  CommandInteraction,
  MessageFlags,
  ApplicationCommandOptionType,
  GuildMember,
  Role,
  User,
} from "discord.js";
import { prisma, patrolTimer } from "../../main.js";
import type { RuleEligibilityEntry, PromotionEligibilityReport } from "../../managers/patrol/patrolTimerManager.js";
import type { PromotionRule } from "../../managers/patrol/patrolTimerManager.js";
import { PermissionNodeGuard } from "../../utility/guards.js";
import { loggers } from "../../utility/logger.js";
import { ensureGuildMembersFetched } from "../../utility/guildMemberCache.js";

/** Strip to only A-z and . so role names can't inject formatting. */
function scrubRoleDisplay(name: string): string {
  return name.replace(/[^a-zA-Z.]/g, "") || name;
}

function formatRuleCooldownLabel(r: PromotionRule | RuleEligibilityEntry): string {
  const cooldown =
    r.cooldownHours !== null && r.cooldownHours !== undefined ? `, cooldown ${r.cooldownHours}h` : "";
  const declined =
    "declinedCooldownHours" in r && r.declinedCooldownHours !== undefined
      ? `, declined ${r.declinedCooldownHours}h`
      : "";
  return `${cooldown}${declined}`;
}

function formatPromotionEligibilityReport(
  header: string,
  report: PromotionEligibilityReport | null,
  totalHoursFallback: number,
): string {
  const totalHours = report?.totalHours ?? totalHoursFallback;
  let content = `${header}\n**Total patrol hours:** ${totalHours.toFixed(2)}h\n\n`;
  if (report?.onLOA) {
    content += "⚠️ User is on **LOA** - promotion suggestions are paused.\n\n";
  }
  if (report?.blocked) {
    content += `🚫 User is **blocked from promotion suggestions**${report.blockReason ? `: ${report.blockReason}` : ""}.\n\n`;
  }
  if (report && report.rules.length > 0) {
    content += "**Why no promotion (per rule):**\n";
    for (let i = 0; i < report.rules.length; i++) {
      const r = report.rules[i];
      const ruleTitle = `${i + 1}. ${r.currentRankName} → ${r.nextRankName} (requires ${r.requiredHours}h${formatRuleCooldownLabel(r)})`;
      if (!r.hasCurrentRole) {
        content += `• ${ruleTitle}\n  └ Not eligible: missing current rank role **${r.currentRankName}**.\n`;
        continue;
      }
      const reasons: string[] = [];
      if (!r.hoursMet) {
        reasons.push(`hours: ${r.totalHours.toFixed(1)}h, need ${r.requiredHours}h (**${r.hoursRemaining.toFixed(1)}h more**)`);
      } else {
        reasons.push(`hours: ✓ (${r.totalHours.toFixed(1)}h ≥ ${r.requiredHours}h)`);
      }
      if (r.cooldownKind === "declined") {
        if (!r.cooldownMet && r.hoursSinceCooldownStart !== null) {
          const remaining = r.declinedCooldownHours - r.hoursSinceCooldownStart;
          reasons.push(`declined cooldown: ${r.hoursSinceCooldownStart.toFixed(1)}h since denial (required ${r.declinedCooldownHours}h). **${remaining.toFixed(1)}h left**`);
        } else if (r.hoursSinceCooldownStart !== null) {
          reasons.push(`declined cooldown: ✓ (${r.hoursSinceCooldownStart.toFixed(1)}h since denial, required ${r.declinedCooldownHours}h)`);
        }
      } else if (r.cooldownHours !== undefined && r.cooldownHours !== null && r.cooldownHours > 0) {
        if (r.cooldownKind === "unchecked") {
          reasons.push(`cooldown: no data for when they got **${r.currentRankName}** (need ${r.cooldownHours}h since then)`);
        } else if (!r.cooldownMet && r.hoursSinceCooldownStart !== null) {
          const remaining = r.cooldownHours - r.hoursSinceCooldownStart;
          reasons.push(`cooldown: ${r.hoursSinceCooldownStart.toFixed(1)}h since role (required ${r.cooldownHours}h). **${remaining.toFixed(1)}h left**`);
        } else if (r.hoursSinceCooldownStart !== null) {
          reasons.push(`cooldown: ✓ (${r.hoursSinceCooldownStart.toFixed(1)}h since role, required ${r.cooldownHours}h)`);
        }
      }
      if (r.alreadyNotified) {
        reasons.push(`already notified for **${r.nextRankName}** (denied users need **1+ extra hour** since last notification, or use \`reset-user\`)`);
      }
      content += `• ${ruleTitle}\n  └ ${reasons.join("; ")}\n`;
    }
  } else {
    content += "No promotion rules are configured, or no detailed report could be generated.";
  }
  return content;
}

@Discord()
@SlashGroup({
  name: "promotion",
  description: "Patrol promotion actions",
  root: "patrol",
})
@SlashGroup("promotion", "patrol")
@Guard(PermissionNodeGuard("settings.command.promotion"))
export class PatrolPromotionCommands {
  @Slash({
    name: "check",
    description: "Check user promotion eligibility",
  })
  async check(
    @SlashOption({
      name: "user",
      description: "User",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId || !interaction.guild) {return;}

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      if (!settings?.promotionChannelId) {
        await interaction.editReply({
          content: "❌ Promotion system is not fully configured. Set the promotion channel first.",
        });
        return;
      }
      const rules = patrolTimer.getEffectivePromotionRules(settings);
      if (!rules || rules.length === 0) {
        await interaction.editReply({
          content: "❌ No promotion rules configured. Use `/settings patrol add-rule`.",
        });
        return;
      }

      const member = await interaction.guild.members.fetch(user.id);
      if (!member) {
        await interaction.editReply({
          content: "❌ User not found in this server.",
        });
        return;
      }

      const sent = await patrolTimer.runPromotionCheckForMember(interaction.guildId, member);
      if (sent) {
        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "promotion-check",
          interaction.user.id,
          user.id,
          "Notification sent to promotion channel.",
        );
        await interaction.editReply({
          content: `✅ Promotion notification sent for <@${user.id}> in <#${settings.promotionChannelId}>.`,
        });
        loggers.patrol.info(`Manual promotion check for ${user.tag} by ${interaction.user.tag}`);
      } else {
        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "promotion-check",
          interaction.user.id,
          user.id,
          "No notification sent (not eligible or already notified).",
        );
        const report = await patrolTimer.getPromotionEligibilityReport(interaction.guildId, member);
        const totalHours =
          report?.totalHours ?? (await patrolTimer.getUserTotal(interaction.guildId, user.id)) / (1000 * 60 * 60);
        const content = formatPromotionEligibilityReport(
          `**Promotion check: <@${user.id}>**`,
          report,
          totalHours,
        );
        await interaction.editReply({ content });
      }
    } catch (err) {
      loggers.patrol.error("Manual promotion check error", err);
      await interaction.editReply({
        content: "❌ An error occurred while checking for promotion. Please check the logs.",
      });
    }
  }

  @Slash({
    name: "suggest",
    description: "Suggest user for promotion",
  })
  async suggest(
    @SlashOption({
      name: "user",
      description: "User",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId || !interaction.guild) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      if (!settings?.promotionChannelId) {
        await interaction.editReply({
          content: "❌ Promotion system is not fully configured. Set the promotion channel first.",
        });
        return;
      }
      const rules = patrolTimer.getEffectivePromotionRules(settings);
      if (!rules || rules.length === 0) {
        await interaction.editReply({
          content: "❌ No promotion rules configured. Use `/settings patrol add-rule`.",
        });
        return;
      }

      const member = await interaction.guild.members.fetch(user.id);
      if (!member) {
        await interaction.editReply({
          content: "❌ User not found in this server.",
        });
        return;
      }

      const sent = await patrolTimer.runPromotionCheckForMember(interaction.guildId, member, {
        bypassCooldown: true,
      });
      if (sent) {
        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "promotion-suggest",
          interaction.user.id,
          user.id,
          "Suggestion sent (cooldown bypassed).",
        );
        await interaction.editReply({
          content: `✅ Promotion suggestion sent for <@${user.id}> in <#${settings.promotionChannelId}> (cooldown bypassed).`,
        });
        loggers.patrol.info(`Promotion suggest for ${user.tag} by ${interaction.user.tag} (cooldown bypassed)`);
      } else {
        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "promotion-suggest",
          interaction.user.id,
          user.id,
          "No notification sent (hours or notification rules not met).",
        );
        const report = await patrolTimer.getPromotionEligibilityReport(interaction.guildId, member);
        const totalHours =
          report?.totalHours ?? (await patrolTimer.getUserTotal(interaction.guildId, user.id)) / (1000 * 60 * 60);
        const content = formatPromotionEligibilityReport(
          `**Promotion suggest: <@${user.id}>** (cooldown bypassed)`,
          report,
          totalHours,
        );
        await interaction.editReply({ content });
      }
    } catch (err) {
      loggers.patrol.error("Promotion suggest error", err);
      await interaction.editReply({
        content: "❌ An error occurred while suggesting for promotion. Please check the logs.",
      });
    }
  }

  @Slash({
    name: "check-all",
    description: "Check all users for promotion",
  })
  async checkAll(interaction: CommandInteraction) {
    if (!interaction.guildId || !interaction.guild) {return;}

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      if (!settings?.promotionChannelId) {
        await interaction.editReply({
          content: "❌ Promotion system is not fully configured. Set the promotion channel first.",
        });
        return;
      }

      const rules = patrolTimer.getEffectivePromotionRules(settings);
      if (!rules || rules.length === 0) {
        await interaction.editReply({
          content: "❌ No promotion rules configured. Use `/settings patrol add-rule`.",
        });
        return;
      }

      const currentRankIds = [...new Set(rules.map((r) => r.currentRankRoleId))];
      await ensureGuildMembersFetched(interaction.guild);
      const membersToCheck = new Map<string, GuildMember>();
      for (const roleId of currentRankIds) {
        const role = await interaction.guild.roles.fetch(roleId);
        if (!role) {
          continue;
        }
        for (const [, member] of role.members) {
          if (!member.user.bot) {
            membersToCheck.set(member.id, member);
          }
        }
      }

      if (membersToCheck.size === 0) {
        await interaction.editReply({
          content: "ℹ️ No members found with any current-rank role from your promotion rules.",
        });
        return;
      }

      let sentCount = 0;
      for (const member of membersToCheck.values()) {
        const sent = await patrolTimer.runPromotionCheckForMember(interaction.guildId, member);
        if (sent) {
          sentCount++;
        }
      }

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "promotion-check-all",
        interaction.user.id,
        undefined,
        `Checked ${membersToCheck.size} member(s). Sent ${sentCount} notification(s).`,
      );

      await interaction.editReply({
        content: `**Promotion check complete.**\nChecked ${membersToCheck.size} member(s) with current-rank roles. Sent **${sentCount}** notification(s).`,
      });
      loggers.patrol.info(`Bulk promotion check by ${interaction.user.tag}: ${sentCount} notification(s) sent for ${membersToCheck.size} members`);
    } catch (err) {
      loggers.patrol.error("Bulk promotion check error", err);
      await interaction.editReply({
        content: "❌ An error occurred while checking promotions. Please check the logs.",
      });
    }
  }

  @Slash({
    name: "resuggest-all",
    description: "Resuggest pending promotions",
  })
  async resuggestAll(interaction: CommandInteraction) {
    if (!interaction.guildId || !interaction.guild) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      if (!settings?.promotionChannelId) {
        await interaction.editReply({
          content: "❌ Promotion system is not fully configured. Set the promotion channel first.",
        });
        return;
      }

      const result = await patrolTimer.resuggestAllPendingPromotions(
        interaction.guild,
        interaction.user.id,
      );

      if (result.resent === 0 && result.skipped === 0) {
        await interaction.editReply({
          content: "ℹ️ No pending promotion notifications to resuggest.",
        });
        return;
      }

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "promotion-resuggest-all",
        interaction.user.id,
        undefined,
        `Resent ${result.resent}, skipped ${result.skipped}. Thread: ${result.threadId ?? "none"}`,
      );

      const threadMention = result.threadId ? `<#${result.threadId}>` : "thread";
      await interaction.editReply({
        content: `✅ Resuggested **${result.resent}** pending promotion(s) in ${threadMention}.${result.skipped > 0 ? ` Skipped ${result.skipped}.` : ""} Original messages were marked superseded.`,
      });
      loggers.patrol.info(
        `Promotion resuggest-all by ${interaction.user.tag}: ${result.resent} resent, ${result.skipped} skipped`,
      );
    } catch (err) {
      loggers.patrol.error("Promotion resuggest-all error", err);
      await interaction.editReply({
        content: "❌ An error occurred while resuggesting promotions. Please check the logs.",
      });
    }
  }

  @Slash({
    name: "list-notifications",
    description: "List promotion notifications",
  })
  async listNotifications(
    @SlashChoice({ name: "Pending", value: "PENDING" })
    @SlashChoice({ name: "Approved", value: "APPROVED" })
    @SlashChoice({ name: "Denied", value: "DENIED" })
    @SlashOption({
      name: "status",
      description: "Filter by status (omit for all)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    statusFilter: "PENDING" | "APPROVED" | "DENIED" | undefined,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId || !interaction.guild) {
      return;
    }

    const where = { guildId: interaction.guildId } as { guildId: string; status?: string };
    if (statusFilter) {
      where.status = statusFilter;
    }

    const notifications = await prisma.voicePatrolPromotionNotification.findMany({
      where,
      orderBy: [{ status: "asc" }, { notifiedAt: "desc" }],
      take: 50,
    });

    if (notifications.length === 0) {
      const statusLabel = statusFilter ? ` with status **${statusFilter}**` : "";
      await interaction.reply({
        content: `ℹ️ No promotion notifications${statusLabel}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guild = interaction.guild;
    const lines: string[] = [];
    for (const n of notifications) {
      const nextRankName = scrubRoleDisplay(
        guild.roles.cache.get(n.nextRankRoleId)?.name ?? n.nextRankRoleId,
      );
      const hours = n.totalHoursAtNotify !== null && n.totalHoursAtNotify !== undefined ? `${n.totalHoursAtNotify.toFixed(1)}h` : "-";
      const notified = `<t:${Math.floor(n.notifiedAt.getTime() / 1000)}:R>`;
      let resolved = "";
      if (n.resolvedAt && n.resolvedBy) {
        resolved = ` · Resolved <t:${Math.floor(n.resolvedAt.getTime() / 1000)}:R> by <@${n.resolvedBy}>`;
      }
      lines.push(
        `**${n.status}** · <@${n.userId}> → **${nextRankName}** (${hours} at notify) ${notified}${resolved}`,
      );
    }
    const statusLabel = statusFilter ? ` (${statusFilter})` : "";
    const header = `**Promotion notifications**${statusLabel} (${notifications.length} total)\n\n`;
    let body = lines.join("\n");
    const maxBody = 2000 - header.length - 50;
    if (body.length > maxBody) {
      let truncated = "";
      let included = 0;
      for (const line of lines) {
        if ((truncated + line + "\n").length > maxBody) {
          break;
        }
        truncated += line + "\n";
        included++;
      }
      const omitted = lines.length - included;
      body = truncated + (omitted > 0 ? `\n… and ${omitted} more.` : "");
    }
    await interaction.reply({
      content: header + body,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "reset-user",
    description: "Reset user promotion tracking",
  })
  async resetUser(
    @SlashOption({
      name: "user",
      description: "User",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "next_rank",
      description: "Next rank (empty = all)",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    nextRank: Role | undefined,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {return;}

    if (nextRank) {
      const deleted = await prisma.voicePatrolPromotionNotification.deleteMany({
        where: {
          guildId: interaction.guildId,
          userId: user.id,
          nextRankRoleId: nextRank.id,
        },
      });
      if (deleted.count > 0) {
        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "promotion-reset-user",
          interaction.user.id,
          user.id,
          `Next rank: ${scrubRoleDisplay(nextRank.name)}. ${deleted.count} record(s) removed.`,
        );
        await interaction.reply({
          content: `✅ Reset promotion tracking for <@${user.id}> for next rank ${scrubRoleDisplay(nextRank.name)}.`,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: `ℹ️ <@${user.id}> has no notification record for ${scrubRoleDisplay(nextRank.name)}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    const { count: total } = await prisma.voicePatrolPromotionNotification.deleteMany({
      where: { guildId: interaction.guildId, userId: user.id },
    });
    if (total > 0) {
      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "promotion-reset-user",
        interaction.user.id,
        user.id,
        `All. ${total} record(s) removed.`,
      );
      await interaction.reply({
        content: `✅ Reset all promotion tracking for <@${user.id}> (${total} record(s) removed). They can be notified again if they meet the criteria.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        content: `ℹ️ <@${user.id}> has no promotion records to reset.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "block-suggest",
    description: "Block a user from promotion suggestions",
  })
  async blockSuggest(
    @SlashOption({
      name: "user",
      description: "User to block",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "reason",
      description: "Optional reason",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | undefined,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {
      return;
    }

    await prisma.user.upsert({
      where: { discordId: user.id },
      create: { discordId: user.id },
      update: {},
    });

    await prisma.voicePatrolPromotionBlock.upsert({
      where: { guildId_userId: { guildId: interaction.guildId, userId: user.id } },
      update: { reason: reason ?? null, setBy: interaction.user.id },
      create: {
        guildId: interaction.guildId,
        userId: user.id,
        reason: reason ?? null,
        setBy: interaction.user.id,
      },
    });

    await patrolTimer.logCommandUsage(
      interaction.guildId,
      "promotion-block-suggest",
      interaction.user.id,
      user.id,
      reason ?? "No reason provided",
    );

    await interaction.reply({
      content: `✅ <@${user.id}> will no longer receive promotion suggestions.${reason ? `\n**Reason:** ${reason}` : ""}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "unblock-suggest",
    description: "Remove promotion suggestion block for a user",
  })
  async unblockSuggest(
    @SlashOption({
      name: "user",
      description: "User to unblock",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {
      return;
    }

    const deleted = await prisma.voicePatrolPromotionBlock.deleteMany({
      where: { guildId: interaction.guildId, userId: user.id },
    });

    if (deleted.count === 0) {
      await interaction.reply({
        content: `ℹ️ <@${user.id}> was not blocked from promotion suggestions.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await patrolTimer.logCommandUsage(
      interaction.guildId,
      "promotion-unblock-suggest",
      interaction.user.id,
      user.id,
      "Block removed",
    );

    await interaction.reply({
      content: `✅ <@${user.id}> can receive promotion suggestions again.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
