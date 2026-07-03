import { Discord, Guard, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  CommandInteraction,
  MessageFlags,
  ApplicationCommandOptionType,
  Channel,
  GuildMember,
  Role,
  ChannelType,
  User,
} from "discord.js";
import { Prisma } from "../../../generated/prisma/index.js";
import { prisma, patrolTimer } from "../../../main.js";
import type { PromotionRule, RuleEligibilityEntry, PromotionEligibilityReport } from "../../../managers/patrol/patrolTimerManager.js";
import { DEFAULT_DECLINED_COOLDOWN_HOURS } from "../../../managers/patrol/patrolTimerManager.js";
import { PermissionNodeGuard } from "../../../utility/permissionNodes.js";
import { loggers } from "../../../utility/logger.js";

/** Strip to only A-z and . so role names can't inject formatting. */
function scrubRoleDisplay(name: string): string {
  return name.replace(/[^a-zA-Z.]/g, "") || name;
}

function describePromotionRule(
  currentRankName: string,
  nextRankName: string,
  rule: PromotionRule,
): string {
  const cooldownStr =
    rule.cooldownHours !== null && rule.cooldownHours !== undefined ? `, cooldown ${rule.cooldownHours}h` : "";
  const declinedStr =
    rule.declinedCooldownHours !== undefined && rule.declinedCooldownHours !== null
      ? `, declined ${rule.declinedCooldownHours}h`
      : `, declined ${DEFAULT_DECLINED_COOLDOWN_HOURS}h (default)`;
  return `${scrubRoleDisplay(currentRankName)} → ${scrubRoleDisplay(nextRankName)} at ${rule.requiredHours}h${cooldownStr}${declinedStr}`;
}

function findPromotionRuleIndex(
  rules: PromotionRule[],
  currentRankRoleId: string,
  nextRankRoleId: string,
): number {
  return rules.findIndex(
    (r) => r.currentRankRoleId === currentRankRoleId && r.nextRankRoleId === nextRankRoleId,
  );
}

function formatRuleCooldownLabel(r: PromotionRule | RuleEligibilityEntry): string {
  const cooldown =
    r.cooldownHours !== null && r.cooldownHours !== undefined ? `, cooldown ${r.cooldownHours}h` : "";
  const declined =
    "declinedCooldownHours" in r && r.declinedCooldownHours !== DEFAULT_DECLINED_COOLDOWN_HOURS
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
    content += "⚠️ User is on **LOA** — promotion suggestions are paused.\n\n";
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
  name: "settings",
  description: "Settings",
  root: "patrol",
})
@SlashGroup("settings", "patrol")
@Guard(PermissionNodeGuard("settings.command.promotion"))
export class SettingsPatrolPromotionCommands {
  @Slash({
    name: "set-channel",
    description: "Set promotion notification channel",
  })
  async setChannel(
    @SlashOption({
      name: "channel",
      description: "Notification channel",
      type: ApplicationCommandOptionType.Channel,
      required: true,
    })
    channel: Channel,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {return;}

    // Verify it's a text channel
    if (
      channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildAnnouncement
    ) {
      await interaction.reply({
        content: "❌ The channel must be a text or announcement channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Update settings
    await prisma.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      update: { promotionChannelId: channel.id },
      create: { guildId: interaction.guildId, promotionChannelId: channel.id },
    });

    await patrolTimer.logCommandUsage(
      interaction.guildId,
      "promotion-set-channel",
      interaction.user.id,
      undefined,
      `Channel set to <#${channel.id}>`,
    );

    await interaction.reply({
      content: `✅ Promotion channel set to <#${channel.id}>`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "set-to-promote-channel",
    description: "Set to-promote post channel",
  })
  async setToPromoteChannel(
    @SlashOption({
      name: "channel",
      description: "To-promote channel",
      type: ApplicationCommandOptionType.Channel,
      required: true,
    })
    channel: Channel,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {
      return;
    }

    if (
      channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildAnnouncement
    ) {
      await interaction.reply({
        content: "❌ The channel must be a text or announcement channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await prisma.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      update: { toPromoteChannelId: channel.id },
      create: { guildId: interaction.guildId, toPromoteChannelId: channel.id },
    });

    await patrolTimer.logCommandUsage(
      interaction.guildId,
      "promotion-set-to-promote-channel",
      interaction.user.id,
      undefined,
      `Channel set to <#${channel.id}>`,
    );

    await interaction.reply({
      content: `✅ To-promote channel set to <#${channel.id}>`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "view",
    description: "View promotion settings",
  })
  async view(interaction: CommandInteraction) {
    if (!interaction.guildId) {return;}

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: interaction.guildId },
    });

    if (!settings) {
      await interaction.reply({
        content: "❌ No settings configured yet.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = settings.promotionChannelId
      ? `<#${settings.promotionChannelId}>`
      : "Not set";
    const toPromoteChannel = (settings as { toPromoteChannelId?: string | null }).toPromoteChannelId
      ? `<#${(settings as { toPromoteChannelId: string }).toPromoteChannelId}>`
      : "Not set";
    const guild = interaction.guild;
    const rules = patrolTimer.getEffectivePromotionRules(settings);
    let rulesBlock = "";
    if (rules && rules.length > 0) {
      rulesBlock = "\n**Rules:**\n" + rules.map((r, i) => {
        const cooldown = r.cooldownHours !== null && r.cooldownHours !== undefined ? `, cooldown ${r.cooldownHours}h` : "";
        const declined =
          r.declinedCooldownHours !== undefined && r.declinedCooldownHours !== null
            ? `, declined ${r.declinedCooldownHours}h`
            : `, declined ${DEFAULT_DECLINED_COOLDOWN_HOURS}h (default)`;
        const currentName = scrubRoleDisplay(guild?.roles.cache.get(r.currentRankRoleId)?.name ?? r.currentRankRoleId);
        const nextLabel = scrubRoleDisplay(guild?.roles.cache.get(r.nextRankRoleId)?.name ?? r.nextRankRoleId);
        return `${i + 1}. ${currentName} → ${nextLabel} at ${r.requiredHours}h${cooldown}${declined}`;
      }).join("\n");
    } else {
      rulesBlock = "\n**Rules:** No rules configured. Use add-rule.";
    }

    const message = `**Promotion Settings**
**Promotion channel:** ${channel}
**To-promote channel:** ${toPromoteChannel}
${rulesBlock}

${!settings.promotionChannelId ? "\n⚠️ Set channel to enable promotion notifications." : ""}`;

    await interaction.reply({
      content: message,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "disable",
    description: "Disable promotion notifications",
  })
  async disable(interaction: CommandInteraction) {
    if (!interaction.guildId) {return;}

    await prisma.guildSettings.update({
      where: { guildId: interaction.guildId },
      data: {
        promotionChannelId: null,
        promotionRules: Prisma.JsonNull,
      },
    });

    await patrolTimer.logCommandUsage(
      interaction.guildId,
      "promotion-disable",
      interaction.user.id,
      undefined,
      "Promotion notification system disabled.",
    );

    await interaction.reply({
      content: "✅ Promotion notification system disabled.",
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "add-rule",
    description: "Add promotion rule",
  })
  async addRule(
    @SlashOption({
      name: "current_rank",
      description: "Current rank role",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    currentRank: Role,
    @SlashOption({
      name: "next_rank",
      description: "Next rank role",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    nextRank: Role,
    @SlashOption({
      name: "required_hours",
      description: "Required patrol hours",
      type: ApplicationCommandOptionType.Number,
      required: true,
      minValue: 0.1,
      maxValue: 10000,
    })
    requiredHours: number,
    @SlashOption({
      name: "cooldown_hours",
      description: "Cooldown hours (optional)",
      type: ApplicationCommandOptionType.Number,
      required: false,
      minValue: 0,
      maxValue: 5000,
    })
    cooldownHours: number | undefined,
    @SlashOption({
      name: "declined_cooldown_hours",
      description: "Cooldown hours after denial for this rank (default 360h / 15 days)",
      type: ApplicationCommandOptionType.Number,
      required: false,
      minValue: 0,
      maxValue: 5000,
    })
    declinedCooldownHours: number | undefined,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {return;}

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: interaction.guildId },
    });
    const existing = (settings?.promotionRules as PromotionRule[] | null) ?? [];
    if (findPromotionRuleIndex(existing, currentRank.id, nextRank.id) !== -1) {
      await interaction.reply({
        content: `❌ A rule already exists for ${scrubRoleDisplay(currentRank.name)} → ${scrubRoleDisplay(nextRank.name)}. Use \`edit-rule\` to change it in place.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const newRule: PromotionRule = {
      currentRankRoleId: currentRank.id,
      nextRankRoleId: nextRank.id,
      requiredHours,
      ...(cooldownHours !== null && cooldownHours !== undefined && cooldownHours >= 0 ? { cooldownHours } : {}),
      ...(declinedCooldownHours !== null && declinedCooldownHours !== undefined && declinedCooldownHours >= 0
        ? { declinedCooldownHours }
        : {}),
    };
    const updated = [...existing, newRule];
    await prisma.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      update: { promotionRules: updated as unknown as object },
      create: { guildId: interaction.guildId, promotionRules: updated as unknown as object },
    });
    const ruleDesc = describePromotionRule(currentRank.name, nextRank.name, newRule);
    await patrolTimer.logCommandUsage(
      interaction.guildId,
      "promotion-add-rule",
      interaction.user.id,
      undefined,
      ruleDesc,
    );
    await interaction.reply({
      content: `✅ Added rule: ${ruleDesc}.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "remove-rule",
    description: "Remove promotion rule",
  })
  async removeRule(
    @SlashOption({
      name: "current_rank",
      description: "Current rank role",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    currentRank: Role,
    @SlashOption({
      name: "next_rank",
      description: "Next rank role",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    nextRank: Role,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {return;}

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: interaction.guildId },
    });
    const rules = (settings?.promotionRules as PromotionRule[] | null) ?? [];
    const filtered = rules.filter(
      (r) => r.currentRankRoleId !== currentRank.id || r.nextRankRoleId !== nextRank.id,
    );
    if (filtered.length === rules.length) {
      await interaction.reply({
        content: `❌ No rule found for ${scrubRoleDisplay(currentRank.name)} → ${scrubRoleDisplay(nextRank.name)}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await prisma.guildSettings.update({
      where: { guildId: interaction.guildId },
      data: { promotionRules: filtered.length > 0 ? (filtered as unknown as object) : Prisma.JsonNull },
    });
    const removedRuleDesc = `${scrubRoleDisplay(currentRank.name)} → ${scrubRoleDisplay(nextRank.name)}`;
    await patrolTimer.logCommandUsage(
      interaction.guildId,
      "promotion-remove-rule",
      interaction.user.id,
      undefined,
      removedRuleDesc,
    );
    await interaction.reply({
      content: `✅ Removed rule: ${removedRuleDesc}.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "edit-rule",
    description: "Edit an existing promotion rule in place (keeps enrolled users' progress)",
  })
  async editRule(
    @SlashOption({
      name: "current_rank",
      description: "Current rank role (identifies the rule)",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    currentRank: Role,
    @SlashOption({
      name: "next_rank",
      description: "Next rank role (identifies the rule)",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    nextRank: Role,
    @SlashOption({
      name: "required_hours",
      description: "New required patrol hours (omit to keep current)",
      type: ApplicationCommandOptionType.Number,
      required: false,
      minValue: 0.1,
      maxValue: 10000,
    })
    requiredHours: number | undefined,
    @SlashOption({
      name: "cooldown_hours",
      description: "New cooldown hours (omit to keep; 0 removes cooldown)",
      type: ApplicationCommandOptionType.Number,
      required: false,
      minValue: 0,
      maxValue: 5000,
    })
    cooldownHours: number | undefined,
    @SlashOption({
      name: "declined_cooldown_hours",
      description: "New declined cooldown hours after denial (omit to keep current)",
      type: ApplicationCommandOptionType.Number,
      required: false,
      minValue: 1,
      maxValue: 5000,
    })
    declinedCooldownHours: number | undefined,
    @SlashOption({
      name: "use_default_declined_cooldown",
      description: "Revert declined cooldown to the default (360h / 15 days)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    useDefaultDeclinedCooldown: boolean | undefined,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {
      return;
    }

    const hasChange =
      requiredHours !== undefined ||
      cooldownHours !== undefined ||
      declinedCooldownHours !== undefined ||
      useDefaultDeclinedCooldown === true;
    if (!hasChange) {
      await interaction.reply({
        content: "❌ Provide at least one value to change (`required_hours`, `cooldown_hours`, `declined_cooldown_hours`, or `use_default_declined_cooldown`).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (useDefaultDeclinedCooldown && declinedCooldownHours !== undefined) {
      await interaction.reply({
        content: "❌ Use either `declined_cooldown_hours` or `use_default_declined_cooldown`, not both.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: interaction.guildId },
    });
    const rules = [...((settings?.promotionRules as PromotionRule[] | null) ?? [])];
    const ruleIndex = findPromotionRuleIndex(rules, currentRank.id, nextRank.id);
    if (ruleIndex === -1) {
      await interaction.reply({
        content: `❌ No rule found for ${scrubRoleDisplay(currentRank.name)} → ${scrubRoleDisplay(nextRank.name)}. Use \`add-rule\` to create one.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const beforeDesc = describePromotionRule(currentRank.name, nextRank.name, rules[ruleIndex]);
    const updatedRule: PromotionRule = { ...rules[ruleIndex] };

    if (requiredHours !== undefined) {
      updatedRule.requiredHours = requiredHours;
    }
    if (cooldownHours !== undefined) {
      if (cooldownHours > 0) {
        updatedRule.cooldownHours = cooldownHours;
      } else {
        delete updatedRule.cooldownHours;
      }
    }
    if (useDefaultDeclinedCooldown) {
      delete updatedRule.declinedCooldownHours;
    } else if (declinedCooldownHours !== undefined) {
      updatedRule.declinedCooldownHours = declinedCooldownHours;
    }

    rules[ruleIndex] = updatedRule;
    await prisma.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      update: { promotionRules: rules as unknown as object },
      create: { guildId: interaction.guildId, promotionRules: rules as unknown as object },
    });

    const afterDesc = describePromotionRule(currentRank.name, nextRank.name, updatedRule);
    await patrolTimer.logCommandUsage(
      interaction.guildId,
      "promotion-edit-rule",
      interaction.user.id,
      undefined,
      `${beforeDesc} → ${afterDesc}`,
    );

    await interaction.reply({
      content: `✅ Updated rule in place.\n**Before:** ${beforeDesc}\n**After:** ${afterDesc}\n\nExisting notification and cooldown records for this rank pair are unchanged.`,
      flags: MessageFlags.Ephemeral,
    });
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
      const hours = n.totalHoursAtNotify !== null && n.totalHoursAtNotify !== undefined ? `${n.totalHoursAtNotify.toFixed(1)}h` : "—";
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
    name: "list-rules",
    description: "List promotion rules",
  })
  async listRules(interaction: CommandInteraction) {
    if (!interaction.guildId) {return;}

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: interaction.guildId },
    });
    const rules = patrolTimer.getEffectivePromotionRules(settings ?? {});
    if (!rules || rules.length === 0) {
      await interaction.reply({
        content: "ℹ️ No promotion rules configured. Use add-rule.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const guild = interaction.guild;
    const lines = rules.map((r, i) => {
      const cooldown = r.cooldownHours !== null && r.cooldownHours !== undefined ? `, cooldown ${r.cooldownHours}h` : "";
      const declined =
        r.declinedCooldownHours !== undefined && r.declinedCooldownHours !== null
          ? `, declined ${r.declinedCooldownHours}h`
          : `, declined ${DEFAULT_DECLINED_COOLDOWN_HOURS}h (default)`;
      const currentName = scrubRoleDisplay(guild?.roles.cache.get(r.currentRankRoleId)?.name ?? r.currentRankRoleId);
      const next = scrubRoleDisplay(guild?.roles.cache.get(r.nextRankRoleId)?.name ?? r.nextRankRoleId);
      return `${i + 1}. ${currentName} → ${next} at ${r.requiredHours}h${cooldown}${declined}`;
    });
    await interaction.reply({
      content: "**Promotion Rules**\n" + lines.join("\n"),
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
      // Get settings
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
          content: "❌ No promotion rules configured. Use add-rule.",
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
          content: "❌ No promotion rules configured. Use add-rule.",
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
      // Get settings
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
          content: "❌ No promotion rules configured. Use add-rule.",
        });
        return;
      }

      const currentRankIds = [...new Set(rules.map((r) => r.currentRankRoleId))];
      await interaction.guild.members.fetch();
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
