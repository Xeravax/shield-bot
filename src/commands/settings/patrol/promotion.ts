import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
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
import type { PromotionRule } from "../../../managers/patrol/patrolTimerManager.js";
import { StaffGuard } from "../../../utility/guards.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
@SlashGroup("promotion", "settings")
@Guard(StaffGuard)
export class SettingsPatrolPromotionCommands {
  @Slash({
    name: "set-channel",
    description: "Set the channel for promotion notifications",
  })
  async setChannel(
    @SlashOption({
      name: "channel",
      description: "The channel to send promotion notifications to",
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

    await interaction.reply({
      content: `✅ Promotion channel set to <#${channel.id}>`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "set-role",
    description: "Set the recruit role required for promotion eligibility",
  })
  async setRole(
    @SlashOption({
      name: "role",
      description: "The recruit role",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    role: Role,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {return;}

    // Update settings
    await prisma.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      update: { promotionRecruitRoleId: role.id },
      create: { guildId: interaction.guildId, promotionRecruitRoleId: role.id },
    });

    await interaction.reply({
      content: `✅ Promotion recruit role set to <@&${role.id}>`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "set-min-hours",
    description: "Set the minimum hours required for promotion",
  })
  async setMinHours(
    @SlashOption({
      name: "hours",
      description: "Minimum total hours (can be decimal, e.g., 4.5)",
      type: ApplicationCommandOptionType.Number,
      required: true,
      minValue: 0.1,
      maxValue: 1000,
    })
    hours: number,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {return;}

    // Update settings
    await prisma.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      update: { promotionMinHours: hours },
      create: { guildId: interaction.guildId, promotionMinHours: hours },
    });

    await interaction.reply({
      content: `✅ Minimum hours for promotion set to ${hours}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "view",
    description: "View current promotion settings",
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
    const role = settings.promotionRecruitRoleId
      ? `<@&${settings.promotionRecruitRoleId}>`
      : "Not set";
    const minHours = settings.promotionMinHours ?? 4;

    const rules = patrolTimer.getEffectivePromotionRules(settings);
    let rulesBlock = "";
    if (rules && rules.length > 0) {
      rulesBlock = "\n**Rules:**\n" + rules.map((r, i) => {
        const cooldown = r.cooldownHours != null ? `, cooldown ${r.cooldownHours}h` : "";
        const nextLabel = r.nextRankRoleId ? `<@&${r.nextRankRoleId}>` : "Deputy (legacy)";
        return `${i + 1}. <@&${r.currentRankRoleId}> → ${nextLabel} at ${r.requiredHours}h${cooldown}`;
      }).join("\n");
    } else {
      rulesBlock = "\n**Rules:** Single legacy rule (Recruit → Deputy at " + minHours + "h).";
    }

    const message = `**Promotion Settings**
**Channel:** ${channel}
**Recruit Role (legacy):** ${role}
**Minimum Hours (legacy):** ${minHours}
${rulesBlock}

${!settings.promotionChannelId ? "\n⚠️ Set channel to enable promotion notifications." : ""}`;

    await interaction.reply({
      content: message,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "disable",
    description: "Disable the promotion notification system",
  })
  async disable(interaction: CommandInteraction) {
    if (!interaction.guildId) {return;}

    await prisma.guildSettings.update({
      where: { guildId: interaction.guildId },
      data: {
        promotionChannelId: null,
        promotionRecruitRoleId: null,
        promotionRules: Prisma.JsonNull,
      },
    });

    await interaction.reply({
      content: "✅ Promotion notification system disabled.",
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "add-rule",
    description: "Add a rank-based promotion rule (current rank → next rank at hours, optional cooldown)",
  })
  async addRule(
    @SlashOption({
      name: "current_rank",
      description: "Role user must have (current rank)",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    currentRank: Role,
    @SlashOption({
      name: "next_rank",
      description: "Next rank they are being notified for",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    nextRank: Role,
    @SlashOption({
      name: "required_hours",
      description: "All-time patrol hours required",
      type: ApplicationCommandOptionType.Number,
      required: true,
      minValue: 0.1,
      maxValue: 10000,
    })
    requiredHours: number,
    @SlashOption({
      name: "cooldown_hours",
      description: "Minimum hours since last promotion notification before this rule can fire (optional)",
      type: ApplicationCommandOptionType.Number,
      required: false,
      minValue: 0,
      maxValue: 5000,
    })
    cooldownHours: number | undefined,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {return;}

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: interaction.guildId },
    });
    const existing = (settings?.promotionRules as PromotionRule[] | null) ?? [];
    const newRule: PromotionRule = {
      currentRankRoleId: currentRank.id,
      nextRankRoleId: nextRank.id,
      requiredHours,
      ...(cooldownHours != null && cooldownHours >= 0 ? { cooldownHours } : {}),
    };
    const updated = [...existing, newRule];
    await prisma.guildSettings.upsert({
      where: { guildId: interaction.guildId },
      update: { promotionRules: updated as unknown as object },
      create: { guildId: interaction.guildId, promotionRules: updated as unknown as object },
    });
    const cooldownStr = cooldownHours != null ? `, cooldown ${cooldownHours}h` : "";
    await interaction.reply({
      content: `✅ Added rule: <@&${currentRank.id}> → <@&${nextRank.id}> at ${requiredHours}h${cooldownStr}.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "remove-rule",
    description: "Remove a promotion rule by current and next rank",
  })
  async removeRule(
    @SlashOption({
      name: "current_rank",
      description: "Current rank role of the rule to remove",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    currentRank: Role,
    @SlashOption({
      name: "next_rank",
      description: "Next rank role of the rule to remove",
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
        content: `❌ No rule found for <@&${currentRank.id}> → <@&${nextRank.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await prisma.guildSettings.update({
      where: { guildId: interaction.guildId },
      data: { promotionRules: filtered.length > 0 ? (filtered as unknown as object) : Prisma.JsonNull },
    });
    await interaction.reply({
      content: `✅ Removed rule: <@&${currentRank.id}> → <@&${nextRank.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "list-rules",
    description: "List all rank-based promotion rules",
  })
  async listRules(interaction: CommandInteraction) {
    if (!interaction.guildId) {return;}

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: interaction.guildId },
    });
    const rules = patrolTimer.getEffectivePromotionRules(settings ?? {});
    if (!rules || rules.length === 0) {
      await interaction.reply({
        content: "ℹ️ No promotion rules configured. Use legacy (set-role + set-min-hours) or add-rule.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const lines = rules.map((r, i) => {
      const cooldown = r.cooldownHours != null ? `, cooldown ${r.cooldownHours}h` : "";
      const next = r.nextRankRoleId ? `<@&${r.nextRankRoleId}>` : "Deputy (legacy)";
      return `${i + 1}. <@&${r.currentRankRoleId}> → ${next} at ${r.requiredHours}h${cooldown}`;
    });
    await interaction.reply({
      content: "**Promotion Rules**\n" + lines.join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "reset-user",
    description: "Reset promotion tracking for a user (all or for a specific next rank)",
  })
  async resetUser(
    @SlashOption({
      name: "user",
      description: "User to reset promotion tracking for",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "next_rank",
      description: "Reset only notification for this next rank (omit to reset all)",
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
        await interaction.reply({
          content: `✅ Reset promotion tracking for <@${user.id}> for next rank <@&${nextRank.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: `ℹ️ <@${user.id}> has no notification record for <@&${nextRank.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    const [legacyDel, newDel] = await Promise.all([
      prisma.voicePatrolPromotion.deleteMany({
        where: { guildId: interaction.guildId, userId: user.id },
      }),
      prisma.voicePatrolPromotionNotification.deleteMany({
        where: { guildId: interaction.guildId, userId: user.id },
      }),
    ]);
    const total = legacyDel.count + newDel.count;
    if (total > 0) {
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
    description: "Manually check a user for promotion eligibility",
  })
  async check(
    @SlashOption({
      name: "user",
      description: "User to check for promotion",
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

      if (!settings?.promotionChannelId || !settings?.promotionRecruitRoleId) {
        await interaction.editReply({
          content: "❌ Promotion system is not fully configured. Set the promotion channel first.",
        });
        return;
      }
      const rules = patrolTimer.getEffectivePromotionRules(settings);
      if (!rules || rules.length === 0) {
        await interaction.editReply({
          content: "❌ No promotion rules configured. Use set-role + set-min-hours (legacy) or add-rule.",
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
        await interaction.editReply({
          content: `✅ Promotion notification sent for <@${user.id}> in <#${settings.promotionChannelId}>.`,
        });
        loggers.patrol.info(`Manual promotion check for ${user.tag} by ${interaction.user.tag}`);
      } else {
        const totalTime = await patrolTimer.getUserTotal(interaction.guildId, user.id);
        const totalHours = totalTime / (1000 * 60 * 60);
        await interaction.editReply({
          content: `ℹ️ <@${user.id}> is not eligible for any promotion right now (already notified for all applicable tiers, or does not meet hours/cooldown). Current total: ${totalHours.toFixed(2)}h.`,
        });
      }
    } catch (err) {
      loggers.patrol.error("Manual promotion check error", err);
      await interaction.editReply({
        content: "❌ An error occurred while checking for promotion. Please check the logs.",
      });
    }
  }

  @Slash({
    name: "check-all",
    description: "Check all users with a current-rank role for promotion (uses same rules as automatic check)",
  })
  async checkAll(interaction: CommandInteraction) {
    if (!interaction.guildId || !interaction.guild) {return;}

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Get settings
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      if (!settings?.promotionChannelId || !settings?.promotionRecruitRoleId) {
        await interaction.editReply({
          content: "❌ Promotion system is not fully configured. Set the promotion channel first.",
        });
        return;
      }

      const rules = patrolTimer.getEffectivePromotionRules(settings);
      if (!rules || rules.length === 0) {
        await interaction.editReply({
          content: "❌ No promotion rules configured. Use set-role + set-min-hours (legacy) or add-rule.",
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
}

