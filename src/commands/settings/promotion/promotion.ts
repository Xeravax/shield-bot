import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  CommandInteraction,
  MessageFlags,
  ApplicationCommandOptionType,
  Channel,
  Role,
  ChannelType,
} from "discord.js";
import { Prisma } from "../../../generated/prisma/index.js";
import { prisma, patrolTimer } from "../../../main.js";
import type { PromotionRule } from "../../../managers/patrol/patrolTimerManager.js";
import { DEFAULT_DECLINED_COOLDOWN_HOURS } from "../../../managers/patrol/patrolTimerManager.js";
import { PermissionNodeGuard } from "../../../utility/guards.js";

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

@Discord()
@SlashGroup("patrol", "settings")
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
}
