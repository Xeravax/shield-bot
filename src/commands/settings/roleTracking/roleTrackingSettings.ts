import {
  Discord,
  Guard,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  MessageFlags,
  EmbedBuilder,
  Colors,
  GuildBasedChannel,
  Role,
  ChannelType,
  AutocompleteInteraction,
  BaseInteraction,
} from "discord.js";
import { Pagination } from "@discordx/pagination";
import { patrolTimer, prisma, roleTrackingManager } from "../../../main.js";
import { PermissionNodeGuard } from "../../../utility/permissionNodes.js";
import { loggers } from "../../../utility/logger.js";
import type { RoleTrackingConfig, RoleTrackingConfigMap, ConditionType } from "../../../managers/roleTracking/roleTrackingManager.js";
import { parseDurationToMs, isValidDuration } from "../../../utility/roleTracking/durationParser.js";

@Discord()
@SlashGroup({
  name: "role-tracking",
  description: "Role tracking",
})
@SlashGroup({
  name: "config",
  description: "Role tracking configuration",
  root: "role-tracking",
})
@SlashGroup("config", "role-tracking")
@Guard(PermissionNodeGuard("settings.command.role-tracking"))
export class SettingsRoleTrackingCommands {
  /**
   * Autocomplete handler for tracked roles
   */
  private async autocompleteTrackedRoles(interaction: AutocompleteInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.respond([]);
      return;
    }

    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      const config = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};
      const focused = interaction.options.getFocused(true);
      const query = focused.value.toLowerCase();

      const guild = interaction.guild;
      if (!guild) {
        await interaction.respond([]);
        return;
      }

      const choices = [];
      for (const [roleId, roleConfig] of Object.entries(config)) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;

        const roleName = role.name.toLowerCase();
        const configName = roleConfig.roleName.toLowerCase();
        
        if (roleName.includes(query) || configName.includes(query) || roleId === query) {
          choices.push({
            name: `${role.name} (${roleConfig.roleName})`,
            value: roleId,
          });
        }
      }

      await interaction.respond(choices.slice(0, 25));
    } catch (error) {
      loggers.bot.error("Error in autocomplete tracked roles", error);
      await interaction.respond([]);
    }
  }

  /**
   * Autocomplete handler for conditions
   */
  private async autocompleteConditions(interaction: AutocompleteInteraction): Promise<void> {
    try {
      const focused = interaction.options.getFocused(true);
      const query = focused.value.toLowerCase();

      const conditions = ["PATROL", "TIME"];
      const choices = conditions
        .filter((c) => c.toLowerCase().includes(query))
        .map((c) => ({
          name: c,
          value: c,
        }));

      await interaction.respond(choices);
    } catch (error) {
      loggers.bot.error("Error in autocomplete conditions", error);
      await interaction.respond([]);
    }
  }

  /**
   * Get default configuration for a role based on deadline
   */
  private getDefaultConfig(
    roleName: string,
    deadline: string,
    _roleId: string,
    staffOnly = false,
  ): RoleTrackingConfig {
    const deadlineMs = parseDurationToMs(deadline);
    if (!deadlineMs) {
      throw new Error(`Invalid deadline: ${deadline}`);
    }

    // Default configuration - Cadet pattern (weekly warnings)
    if (deadlineMs <= 35 * 24 * 60 * 60 * 1000) {
      // 35 days or less - use weekly warnings
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const weeks = Math.floor(deadlineMs / weekMs);
      
      const warnings = [];
      if (!staffOnly) {
        for (let i = 1; i < weeks; i++) {
          warnings.push({
            index: i - 1,
            offset: `${i} week${i > 1 ? "s" : ""}`,
            type: "warning",
            message: `Hello! This is your Week ${i} reminder for the {roleName} role. You have ${weeks - i} week${weeks - i > 1 ? "s" : ""} remaining. Make sure you're getting your patrol time in! If you need extended time, please request a Leave of Absence (LOA).`,
          });
        }
      }

      return {
        enabled: true,
        roleName,
        deadlineDuration: deadline,
        conditions: [], // No conditions by default - must be specified
        patrolTimeThresholdHours: null,
        staffOnly: staffOnly || undefined,
        warnings,
        staffPingOffset: `${weeks} weeks`,
        staffPingMessage: {
          embeds: [
            {
              title: "🚨 Role Tracking Deadline Reached",
              description: "{userMention} has reached the deadline for **{roleName}** role completion.",
              color: 15158332, // Red
              fields: [
                {
                  name: "User Information",
                  value: `**User:** {userMention}\n**Username:** {userName}\n**User ID:** {userId}`,
                  inline: false,
                },
                {
                  name: "Role Assignment",
                  value: `**Role:** {roleName}\n**Assigned:** {assignmentDateTime}\n**Time with Role:** {timeSinceAssignment}`,
                  inline: true,
                },
                {
                  name: "Deadline Information",
                  value: `**Deadline:** {deadlineDateTime}\n**Duration:** {deadlineDuration}\n**Time Overdue:** {timeOverdue}`,
                  inline: true,
                },
                {
                  name: "Patrol Time",
                  value: `**Total:** {patrolTimeHours} hours\n**Formatted:** {patrolTimeFormatted}\n**Threshold:** {thresholdDisplay}`,
                  inline: true,
                },
                {
                  name: "Activity Status",
                  value: `**Inactivity Time:** {inactivityTime}\n**Inactivity %:** {inactivityPercentage}%`,
                  inline: true,
                },
              ],
              timestamp: "{timestamp}",
            },
          ],
        },
      };
    } else {
      // More than 35 days - use monthly warnings
      const monthMs = 30 * 24 * 60 * 60 * 1000;
      const months = Math.floor(deadlineMs / monthMs);
      
      const warnings = [];
      if (!staffOnly) {
        for (let i = 2; i <= months; i++) {
          // Compute ordinal suffix
          const getOrdinalSuffix = (n: number): string => {
            const j = n % 10;
            const k = n % 100;
            if (j === 1 && k !== 11) return "st";
            if (j === 2 && k !== 12) return "nd";
            if (j === 3 && k !== 13) return "rd";
            return "th";
          };
          const suffix = getOrdinalSuffix(i);
          warnings.push({
            index: i - 2,
            offset: `${i} months`,
            type: "warning",
            message: `Hello! This is your ${i}${suffix} month reminder for the {roleName} role. You have ${months - i + 1} month${months - i + 1 > 1 ? "s" : ""} remaining. Keep up with your patrol time! If you need extended time off from S.H.I.E.L.D., please request a Leave of Absence (LOA).`,
          });
        }
      }

      return {
        enabled: true,
        roleName,
        deadlineDuration: deadline,
        conditions: [], // No conditions by default - must be specified
        patrolTimeThresholdHours: null,
        staffOnly: staffOnly || undefined,
        warnings,
        staffPingOffset: `${months} months`,
        staffPingMessage: {
          embeds: [
            {
              title: "🚨 Role Tracking Deadline Reached",
              description: "{userMention} has reached the {deadlineDuration} deadline for **{roleName}** role patrol time requirements.",
              color: 15158332, // Red
              fields: [
                {
                  name: "User Information",
                  value: `**User:** {userMention}\n**Username:** {userName}\n**User ID:** {userId}`,
                  inline: false,
                },
                {
                  name: "Role Assignment",
                  value: `**Role:** {roleName}\n**Assigned:** {assignmentDateTime}\n**Time with Role:** {timeSinceAssignment}`,
                  inline: true,
                },
                {
                  name: "Deadline Information",
                  value: `**Deadline:** {deadlineDateTime}\n**Duration:** {deadlineDuration}\n**Time Overdue:** {timeOverdue}`,
                  inline: true,
                },
                {
                  name: "Patrol Time",
                  value: `**Total:** {patrolTimeHours} hours\n**Formatted:** {patrolTimeFormatted}\n**Threshold:** {thresholdDisplay}`,
                  inline: true,
                },
                {
                  name: "Activity Status",
                  value: `**Inactivity Time:** {inactivityTime}\n**Inactivity %:** {inactivityPercentage}%`,
                  inline: true,
                },
              ],
              timestamp: "{timestamp}",
            },
          ],
        },
      };
    }
  }

  @Slash({
    name: "add-role",
    description: "Add a role to role tracking",
  })
  async addRole(
    @SlashOption({
      name: "role",
      description: "The role to track",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    role: Role,
    @SlashOption({
      name: "deadline",
      description: "Deadline (e.g. 1 month, 90 days)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    deadline: string | null,
    @SlashOption({
      name: "conditions",
      description: "Conditions: PATROL, TIME, or both",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: true,
    })
    conditionsInput: string | null,
    @SlashOption({
      name: "patrol_threshold_hours",
      description: "Patrol hours threshold (for PATROL)",
      type: ApplicationCommandOptionType.Number,
      required: false,
    })
    patrolThresholdHours: number | null,
    @SlashOption({
      name: "staff_channel",
      description: "Staff notification channel",
      type: ApplicationCommandOptionType.Channel,
      required: false,
    })
    staffChannel: GuildBasedChannel | null,
    @SlashOption({
      name: "staff_ping_channel",
      description: "Staff ping channel",
      type: ApplicationCommandOptionType.Channel,
      required: false,
    })
    staffPingChannel: GuildBasedChannel | null,
    @SlashOption({
      name: "staff_ping_roles",
      description: "Roles to ping (IDs or mentions)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    staffPingRolesInput: string | null,
    @SlashOption({
      name: "staff_only",
      description: "Staff-only alerts (no member DMs)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    staffOnlyInput: boolean | null,
    interaction: BaseInteraction,
  ): Promise<void> {
    // Handle autocomplete for conditions
    if (interaction.isAutocomplete()) {
      const focused = (interaction as AutocompleteInteraction).options.getFocused(true);
      if (focused.name === "conditions") {
        return this.autocompleteConditions(interaction as AutocompleteInteraction);
      }
      return;
    }

    const cmdInteraction = interaction as CommandInteraction;
    if (!cmdInteraction.guildId) {
      await cmdInteraction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      // Get current settings first to check if role exists
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: cmdInteraction.guildId },
      });

      const currentConfig = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      const isUpdating = !!currentConfig[role.id];
      const existingConfig = currentConfig[role.id];

      // If updating and no deadline provided, use existing deadline
      // If not updating, deadline is required
      const deadlineToUse = deadline || existingConfig?.deadlineDuration;
      if (!deadlineToUse) {
        await cmdInteraction.reply({
          content: isUpdating 
            ? `❌ Deadline is required when updating. Provide a deadline or the role must already have one configured.`
            : `❌ Deadline is required when adding a new role.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Validate deadline if provided (deadlineToUse is guaranteed to be string at this point)
      if (deadline && !isValidDuration(deadline)) {
        await cmdInteraction.reply({
          content: `❌ Invalid deadline format: "${deadline}". Use formats like "1 week", "2 months", "90 days", etc.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Validate threshold if provided
      if (patrolThresholdHours !== null && patrolThresholdHours < 0) {
        await cmdInteraction.reply({
          content: "❌ Patrol threshold hours must be a positive number.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Parse conditions if provided
      let conditions: ConditionType[] = [];
      if (conditionsInput) {
        const validConditions: ConditionType[] = ["PATROL", "TIME"];
        const inputConditions = conditionsInput.split(",").map((c) => c.trim().toUpperCase());
        
        // Validate all conditions are valid
        const invalidConditions = inputConditions.filter((c) => !validConditions.includes(c as ConditionType));
        if (invalidConditions.length > 0) {
          await cmdInteraction.reply({
            content: `❌ Invalid conditions: ${invalidConditions.join(", ")}. Valid conditions are: PATROL, TIME`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        // Remove duplicates and set conditions
        conditions = [...new Set(inputConditions)] as ConditionType[];
        
        // If PATROL condition is specified, patrol threshold must be provided
        if (conditions.includes("PATROL") && patrolThresholdHours === null) {
          await cmdInteraction.reply({
            content: "❌ PATROL condition requires patrol_threshold_hours to be specified.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      const staffOnly = staffOnlyInput ?? existingConfig?.staffOnly ?? false;

      // Start with existing config if updating, otherwise create default
      let roleConfig: RoleTrackingConfig;
      if (isUpdating && existingConfig) {
        // Merge with existing config - preserve existing values
        roleConfig = { ...existingConfig };
        // Update role name in case it changed
        roleConfig.roleName = role.name;
        // Only update deadline if provided
        if (deadline) {
          roleConfig.deadlineDuration = deadline;
          // If deadline changed, regenerate warnings based on new deadline
          // But preserve existing conditions, staff channel, and other custom settings
          const existingConditions = roleConfig.conditions;
          const existingStaffChannelId = roleConfig.staffChannelId;
          const existingStaffPingChannelId = roleConfig.staffPingChannelId;
          const existingStaffPingRoleIds = roleConfig.staffPingRoleIds;
          const existingPatrolThreshold = roleConfig.patrolTimeThresholdHours;
          const existingCustomStaffPingMessage = roleConfig.customStaffPingMessage;
          
          const newDefaultConfig = this.getDefaultConfig(role.name, deadline, role.id, staffOnly);
          roleConfig.warnings = staffOnly ? [] : newDefaultConfig.warnings;
          roleConfig.staffPingOffset = newDefaultConfig.staffPingOffset;
          roleConfig.staffPingMessage = newDefaultConfig.staffPingMessage;
          roleConfig.staffOnly = staffOnly || undefined;
          
          // Restore preserved values
          if (existingConditions !== undefined) {
            roleConfig.conditions = existingConditions;
          }
          if (existingStaffChannelId !== undefined) {
            roleConfig.staffChannelId = existingStaffChannelId;
          }
          if (existingStaffPingChannelId !== undefined) {
            roleConfig.staffPingChannelId = existingStaffPingChannelId;
          }
          if (existingStaffPingRoleIds !== undefined) {
            roleConfig.staffPingRoleIds = existingStaffPingRoleIds;
          }
          if (existingPatrolThreshold !== undefined) {
            roleConfig.patrolTimeThresholdHours = existingPatrolThreshold;
          }
          if (existingCustomStaffPingMessage !== undefined) {
            roleConfig.customStaffPingMessage = existingCustomStaffPingMessage;
          }
        }
      } else {
        // Create default configuration for new role
        roleConfig = this.getDefaultConfig(role.name, deadlineToUse, role.id, staffOnly);
      }

      if (staffOnly) {
        roleConfig.staffOnly = true;
        roleConfig.warnings = [];
      }
      
      // Update patrol threshold if provided
      if (patrolThresholdHours !== null) {
        roleConfig.patrolTimeThresholdHours = patrolThresholdHours;
      }
      
      // Update conditions if specified
      if (conditions.length > 0) {
        roleConfig.conditions = conditions;
        // If PATROL is in conditions but no threshold is set, remove PATROL from conditions
        if (roleConfig.conditions.includes("PATROL") && (patrolThresholdHours === null || patrolThresholdHours === undefined)) {
          roleConfig.conditions = roleConfig.conditions.filter((c) => c !== "PATROL");
          if (roleConfig.conditions.length === 0) {
            roleConfig.conditions = [];
          }
        }
      } else if (patrolThresholdHours !== null && (!isUpdating || !roleConfig.conditions || roleConfig.conditions.length === 0)) {
        // If patrol threshold is provided but no conditions specified (and not updating with existing conditions), add PATROL and TIME
        roleConfig.conditions = ["PATROL", "TIME"];
      }

      // Validate configuration
      const validation = roleTrackingManager.validateRoleTrackingConfig(roleConfig);
      if (!validation.valid) {
        await cmdInteraction.reply({
          content: `❌ Configuration validation failed:\n${validation.errors.map((e) => `• ${e}`).join("\n")}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Update settings
      const newConfig = {
        ...currentConfig,
        [role.id]: roleConfig,
      };

      const updateData: any = {
        roleTrackingConfig: newConfig as any,
      };

      // Set initialization date if not set
      if (!settings?.roleTrackingInitializedAt) {
        updateData.roleTrackingInitializedAt = new Date();
      }

      // Set staff channel if provided
      if (staffChannel) {
        if (
          staffChannel.type !== ChannelType.GuildText &&
          staffChannel.type !== ChannelType.GuildAnnouncement
        ) {
          await cmdInteraction.reply({
            content: "❌ The staff channel must be a text or announcement channel.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        updateData.roleTrackingStaffChannelId = staffChannel.id;
      }

      // Parse staff ping roles if provided
      let staffPingRoleIds: string[] | null = null;
      if (staffPingRolesInput) {
        // Extract role IDs from mentions or use as-is if they're already IDs
        const roleIdPattern = /<@&(\d+)>|(\d+)/g;
        const matches = staffPingRolesInput.matchAll(roleIdPattern);
        staffPingRoleIds = [];
        for (const match of matches) {
          const roleId = match[1] || match[2];
          if (roleId) {
            staffPingRoleIds.push(roleId);
          }
        }
        if (staffPingRoleIds.length === 0) {
          await cmdInteraction.reply({
            content: "❌ Invalid staff ping roles format. Use role mentions or role IDs (comma-separated).",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      // Update staff ping channel if provided
      if (staffPingChannel) {
        if (
          staffPingChannel.type !== ChannelType.GuildText &&
          staffPingChannel.type !== ChannelType.GuildAnnouncement
        ) {
          await cmdInteraction.reply({
            content: "❌ The staff ping channel must be a text or announcement channel.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        roleConfig.staffPingChannelId = staffPingChannel.id;
      }
      
      // Update staff ping roles if provided
      if (staffPingRoleIds && staffPingRoleIds.length > 0) {
        roleConfig.staffPingRoleIds = staffPingRoleIds;
      }

      await prisma.guildSettings.upsert({
        where: { guildId: cmdInteraction.guildId },
        update: updateData,
        create: {
          guildId: cmdInteraction.guildId,
          ...updateData,
        },
      });

      const embedFields = [
        { name: "Role", value: `<@&${role.id}>`, inline: true },
        { name: "Deadline", value: deadlineToUse, inline: true },
        {
          name: "Conditions",
          value: (roleConfig.conditions && roleConfig.conditions.length > 0) ? roleConfig.conditions.join(", ") : "None (no tracking)",
          inline: true,
        },
        {
          name: "Patrol Threshold",
          value: roleConfig.patrolTimeThresholdHours !== null && roleConfig.patrolTimeThresholdHours !== undefined 
            ? `${roleConfig.patrolTimeThresholdHours} hours` 
            : "Not set",
          inline: true,
        },
        {
          name: "Warnings",
          value: `${roleConfig.warnings.length} warning(s) configured`,
          inline: true,
        },
        {
          name: "Staff Only",
          value: roleConfig.staffOnly ? "Yes" : "No",
          inline: true,
        },
      ];

      if (staffPingChannel) {
        embedFields.push({
          name: "Staff Ping Channel",
          value: `<#${staffPingChannel.id}>`,
          inline: true,
        });
      }

      if (staffPingRoleIds && staffPingRoleIds.length > 0) {
        embedFields.push({
          name: "Staff Ping Roles",
          value: staffPingRoleIds.map((id) => `<@&${id}>`).join(", "),
          inline: false,
        });
      }

      await patrolTimer.logCommandUsage(
        cmdInteraction.guildId,
        "role-tracking-add-role",
        cmdInteraction.user.id,
        undefined,
        `${role.name} (${role.id})`,
      );

      const embed = new EmbedBuilder()
        .setTitle(isUpdating ? "✅ Role Tracking Updated" : "✅ Role Added to Tracking")
        .setDescription(isUpdating 
          ? `Role <@&${role.id}> tracking configuration has been updated.`
          : `Role <@&${role.id}> has been added to role tracking.`)
        .addFields(embedFields)
        .setColor(Colors.Green)
        .setTimestamp();

      await cmdInteraction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      loggers.bot.error("Error adding role to tracking", error);
      await cmdInteraction.reply({
        content: `❌ Failed to add role to tracking: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "set-staff-channel",
    description: "Set guild staff notification channel",
  })
  async setStaffChannel(
    @SlashOption({
      name: "channel",
      description: "Channel for staff notifications",
      type: ApplicationCommandOptionType.Channel,
      required: true,
    })
    channel: GuildBasedChannel,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
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
        update: { roleTrackingStaffChannelId: channel.id },
        create: {
          guildId: interaction.guildId,
          roleTrackingStaffChannelId: channel.id,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "role-tracking-set-staff-channel",
        interaction.user.id,
        undefined,
        channel.id,
      );

      await interaction.reply({
        content: `✅ Role tracking staff channel set to <#${channel.id}>`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error("Error setting staff channel", error);
      await interaction.reply({
        content: `❌ Failed to set staff channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "set-advisor-role",
    description: "Set the advisor role excluded from all role tracking checks",
  })
  async setAdvisorRole(
    @SlashOption({
      name: "role",
      description: "Advisor role (members with this role are excluded from tracking)",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    role: Role,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: { roleTrackingAdvisorRoleId: role.id },
        create: {
          guildId: interaction.guildId,
          roleTrackingAdvisorRoleId: role.id,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "role-tracking-set-advisor-role",
        interaction.user.id,
        undefined,
        `${role.name} (${role.id})`,
      );

      await interaction.reply({
        content: `✅ Role tracking advisor role set to <@&${role.id}>. Members with this role are excluded from all activity checks.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error("Error setting advisor role", error);
      await interaction.reply({
        content: `❌ Failed to set advisor role: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "set-role-staff-channel",
    description: "Set per-role staff channel",
  })
  async setRoleStaffChannel(
    @SlashOption({
      name: "role",
      description: "Tracked role",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    roleId: string,
    @SlashOption({
      name: "channel",
      description: "Staff channel (empty = guild default)",
      type: ApplicationCommandOptionType.Channel,
      required: false,
    })
    channel: GuildBasedChannel | null,
    interaction: BaseInteraction,
  ): Promise<void> {
    if (interaction.isAutocomplete()) {
      return this.autocompleteTrackedRoles(interaction as AutocompleteInteraction);
    }

    const cmdInteraction = interaction as CommandInteraction;
    if (!cmdInteraction.guildId) {
      await cmdInteraction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = cmdInteraction.guild?.roles.cache.get(roleId);
    if (!role) {
      await cmdInteraction.reply({
        content: `❌ Role not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: cmdInteraction.guildId },
      });

      const currentConfig = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (!currentConfig[role.id]) {
        await cmdInteraction.reply({
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/role-tracking config add-role\` first.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const roleConfig = currentConfig[role.id];

      // If channel is null, remove role-specific channel (use guild default)
      if (channel === null) {
        const newConfig = {
          ...currentConfig,
          [role.id]: {
            ...roleConfig,
            staffChannelId: null,
          },
        };

        await prisma.guildSettings.update({
          where: { guildId: cmdInteraction.guildId },
          data: { roleTrackingConfig: newConfig as any },
        });

        await patrolTimer.logCommandUsage(
          cmdInteraction.guildId,
          "role-tracking-set-role-staff-channel",
          cmdInteraction.user.id,
          undefined,
          `${role.name} (${role.id}), cleared`,
        );

        await cmdInteraction.reply({
          content: `✅ Removed role-specific staff channel for <@&${role.id}>. It will now use the guild default channel.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Validate channel type
      if (
        channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement
      ) {
        await cmdInteraction.reply({
          content: "❌ The channel must be a text or announcement channel.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Update role config with channel
      const newConfig = {
        ...currentConfig,
        [role.id]: {
          ...roleConfig,
          staffChannelId: channel.id,
        },
      };

      await prisma.guildSettings.update({
        where: { guildId: cmdInteraction.guildId },
        data: { roleTrackingConfig: newConfig as any },
      });

      await patrolTimer.logCommandUsage(
        cmdInteraction.guildId,
        "role-tracking-set-role-staff-channel",
        cmdInteraction.user.id,
        undefined,
        `${role.name} (${role.id}), channel ${channel.id}`,
      );

      await cmdInteraction.reply({
        content: `✅ Staff channel for <@&${role.id}> set to <#${channel.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error("Error setting role staff channel", error);
      await cmdInteraction.reply({
        content: `❌ Failed to set role staff channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "view-config",
    description: "View role tracking configuration",
  })
  async viewConfig(interaction: CommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      const config = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (Object.keys(config).length === 0) {
        await interaction.editReply({
          content: "ℹ️ No roles are configured for tracking yet. Use `/role-tracking config add-role` to add one.",
        });
        return;
      }

      const roles = Object.entries(config);
      const pageSize = 5;
      const pages: Array<{ embeds: EmbedBuilder[] }> = [];

      for (let i = 0; i < roles.length; i += pageSize) {
        const pageRoles = roles.slice(i, i + pageSize);
        let description = "";

        for (const [roleId, roleConfig] of pageRoles) {
          const status = roleConfig.enabled ? "✅" : "❌";
          const threshold = roleConfig.patrolTimeThresholdHours
            ? `${roleConfig.patrolTimeThresholdHours} hours`
            : "Not set";
          
          const conditions = roleConfig.conditions || ["TIME"];
          const staffChannel = roleConfig.staffChannelId 
            ? `<#${roleConfig.staffChannelId}>` 
            : settings?.roleTrackingStaffChannelId 
              ? `<#${settings.roleTrackingStaffChannelId}> (guild default)` 
              : "Not set";
          
          description += `${status} **<@&${roleId}>** (${roleConfig.roleName})\n`;
          description += `  • Deadline: ${roleConfig.deadlineDuration}\n`;
          description += `  • Conditions: ${conditions.join(", ")}\n`;
          description += `  • Threshold: ${threshold}\n`;
          description += `  • Warnings: ${roleConfig.warnings.length}\n`;
          description += `  • Staff Ping: ${roleConfig.staffPingOffset}\n`;
          description += `  • Staff Channel: ${staffChannel}\n\n`;
        }

        const embed = new EmbedBuilder()
          .setTitle("Role Tracking Configuration")
          .setDescription(description || "No roles configured")
          .setColor(Colors.Blue)
          .setFooter({
            text: `Page ${Math.floor(i / pageSize) + 1} of ${Math.ceil(roles.length / pageSize)} • Total: ${roles.length} role(s)`,
          })
          .setTimestamp();

        // Show guild default channel only on first page if no roles have their own channels
        if (i === 0) {
          if (settings?.roleTrackingStaffChannelId) {
            const hasRoleSpecificChannels = pageRoles.some(([_, roleConfig]) => roleConfig.staffChannelId);
            if (!hasRoleSpecificChannels) {
              embed.addFields({
                name: "Guild Default Staff Channel",
                value: `<#${settings.roleTrackingStaffChannelId}>`,
                inline: true,
              });
            }
          }
          if (settings?.roleTrackingAdvisorRoleId) {
            embed.addFields({
              name: "Excluded Advisor Role",
              value: `<@&${settings.roleTrackingAdvisorRoleId}>`,
              inline: true,
            });
          }
        }

        pages.push({ embeds: [embed] });
      }

      if (pages.length === 1) {
        await interaction.editReply(pages[0]);
        return;
      }

      const pagination = new Pagination(interaction, pages, {
        ephemeral: true,
        time: 120_000,
      });

      await pagination.send();
    } catch (error) {
      loggers.bot.error("Error viewing role tracking config", error);
      if (interaction.deferred) {
        await interaction.editReply({
          content: `❌ Failed to view configuration: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      } else {
        await interaction.reply({
          content: `❌ Failed to view configuration: ${error instanceof Error ? error.message : "Unknown error"}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  @Slash({
    name: "remove-role",
    description: "Remove a role from role tracking",
  })
  async removeRole(
    @SlashOption({
      name: "role",
      description: "Tracked role",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    roleId: string,
    interaction: BaseInteraction,
  ): Promise<void> {
    if (interaction.isAutocomplete()) {
      return this.autocompleteTrackedRoles(interaction as AutocompleteInteraction);
    }

    const cmdInteraction = interaction as CommandInteraction;
    if (!cmdInteraction.guildId) {
      await cmdInteraction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = cmdInteraction.guild?.roles.cache.get(roleId);
    if (!role) {
      await cmdInteraction.reply({
        content: `❌ Role not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: cmdInteraction.guildId },
      });

      const currentConfig = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (!currentConfig[role.id]) {
        await cmdInteraction.reply({
          content: `❌ Role <@&${role.id}> is not configured for tracking.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const newConfig = { ...currentConfig };
      delete newConfig[role.id];

      await prisma.guildSettings.update({
        where: { guildId: cmdInteraction.guildId },
        data: { roleTrackingConfig: newConfig as any },
      });

      await patrolTimer.logCommandUsage(
        cmdInteraction.guildId,
        "role-tracking-remove-role",
        cmdInteraction.user.id,
        undefined,
        `${role.name} (${role.id})`,
      );

      await cmdInteraction.reply({
        content: `✅ Role <@&${role.id}> removed from tracking.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error("Error removing role from tracking", error);
      await cmdInteraction.reply({
        content: `❌ Failed to remove role: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "toggle-role",
    description: "Enable or disable tracking for a role",
  })
  async toggleRole(
    @SlashOption({
      name: "role",
      description: "Tracked role",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    roleId: string,
    @SlashOption({
      name: "enabled",
      description: "Enable or disable tracking",
      type: ApplicationCommandOptionType.Boolean,
      required: true,
    })
    enabled: boolean,
    interaction: BaseInteraction,
  ): Promise<void> {
    if (interaction.isAutocomplete()) {
      return this.autocompleteTrackedRoles(interaction as AutocompleteInteraction);
    }

    const cmdInteraction = interaction as CommandInteraction;
    if (!cmdInteraction.guildId) {
      await cmdInteraction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = cmdInteraction.guild?.roles.cache.get(roleId);
    if (!role) {
      await cmdInteraction.reply({
        content: `❌ Role not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: cmdInteraction.guildId },
      });

      const currentConfig = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (!currentConfig[role.id]) {
        await cmdInteraction.reply({
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/role-tracking config add-role\` first.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const newConfig = {
        ...currentConfig,
        [role.id]: {
          ...currentConfig[role.id],
          enabled,
        },
      };

      await prisma.guildSettings.update({
        where: { guildId: cmdInteraction.guildId },
        data: { roleTrackingConfig: newConfig as any },
      });

      await patrolTimer.logCommandUsage(
        cmdInteraction.guildId,
        "role-tracking-toggle-role",
        cmdInteraction.user.id,
        undefined,
        `${role.name} (${role.id}), ${enabled ? "enabled" : "disabled"}`,
      );

      await cmdInteraction.reply({
        content: `✅ Role <@&${role.id}> tracking ${enabled ? "enabled" : "disabled"}.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error("Error toggling role tracking", error);
      await cmdInteraction.reply({
        content: `❌ Failed to toggle role: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "set-threshold",
    description: "Set patrol time threshold",
  })
  async setThreshold(
    @SlashOption({
      name: "role",
      description: "Tracked role",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    roleId: string,
    @SlashOption({
      name: "threshold_hours",
      description: "Patrol hours (empty removes)",
      type: ApplicationCommandOptionType.Number,
      required: false,
    })
    thresholdHours: number | null,
    interaction: BaseInteraction,
  ): Promise<void> {
    if (interaction.isAutocomplete()) {
      return this.autocompleteTrackedRoles(interaction as AutocompleteInteraction);
    }

    const cmdInteraction = interaction as CommandInteraction;
    if (!cmdInteraction.guildId) {
      await cmdInteraction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = cmdInteraction.guild?.roles.cache.get(roleId);
    if (!role) {
      await cmdInteraction.reply({
        content: `❌ Role not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: cmdInteraction.guildId },
      });

      const currentConfig = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (!currentConfig[role.id]) {
        await cmdInteraction.reply({
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/role-tracking config add-role\` first.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (thresholdHours !== null && thresholdHours < 0) {
        await cmdInteraction.reply({
          content: "❌ Threshold hours must be a positive number.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const roleConfig = { ...currentConfig[role.id] };
      
      // Update threshold
      roleConfig.patrolTimeThresholdHours = thresholdHours ?? null;
      
      // Update conditions based on threshold
      if (thresholdHours !== null) {
        // If threshold is set, ensure PATROL condition is included
        const conditions = roleConfig.conditions || ["TIME"];
        if (!conditions.includes("PATROL")) {
          roleConfig.conditions = [...conditions, "PATROL"];
        }
      } else {
        // If threshold is removed, remove PATROL condition if it exists
        const conditions = roleConfig.conditions || ["TIME"];
        roleConfig.conditions = conditions.filter((c) => c !== "PATROL");
        // Ensure at least TIME condition remains
        if (roleConfig.conditions.length === 0) {
          roleConfig.conditions = ["TIME"];
        }
      }

      const newConfig = {
        ...currentConfig,
        [role.id]: roleConfig,
      };

      await prisma.guildSettings.update({
        where: { guildId: cmdInteraction.guildId },
        data: { roleTrackingConfig: newConfig as any },
      });

      await patrolTimer.logCommandUsage(
        cmdInteraction.guildId,
        "role-tracking-set-threshold",
        cmdInteraction.user.id,
        undefined,
        `${role.name} (${role.id}), ${thresholdHours !== null ? `${thresholdHours}h` : "removed"}`,
      );

      await cmdInteraction.reply({
        content: `✅ Patrol time threshold for <@&${role.id}> ${thresholdHours !== null ? `set to ${thresholdHours} hours` : "removed"}.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error("Error setting threshold", error);
      await cmdInteraction.reply({
        content: `❌ Failed to set threshold: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "set-conditions",
    description: "Set role tracking conditions",
  })
  async setConditions(
    @SlashOption({
      name: "role",
      description: "Tracked role",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    roleId: string,
    @SlashOption({
      name: "conditions",
      description: "PATROL, TIME, or both (comma-separated)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    conditionsInput: string,
    interaction: BaseInteraction,
  ): Promise<void> {
    if (interaction.isAutocomplete()) {
      const autoInteraction = interaction as AutocompleteInteraction;
      const focused = autoInteraction.options.getFocused(true);
      if (focused.name === "role") {
        return this.autocompleteTrackedRoles(autoInteraction);
      } else if (focused.name === "conditions") {
        return this.autocompleteConditions(autoInteraction);
      }
      return;
    }

    const cmdInteraction = interaction as CommandInteraction;
    if (!cmdInteraction.guildId) {
      await cmdInteraction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = cmdInteraction.guild?.roles.cache.get(roleId);
    if (!role) {
      await cmdInteraction.reply({
        content: `❌ Role not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: cmdInteraction.guildId },
      });

      const currentConfig = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (!currentConfig[role.id]) {
        await cmdInteraction.reply({
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/role-tracking config add-role\` first.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Parse conditions
      const validConditions: Array<"PATROL" | "TIME"> = ["PATROL", "TIME"];
      const conditionsList = conditionsInput
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter((c) => validConditions.includes(c as "PATROL" | "TIME")) as Array<"PATROL" | "TIME">;

      if (conditionsList.length === 0) {
        await cmdInteraction.reply({
          content: `❌ Invalid conditions. Must be one or more of: ${validConditions.join(", ")}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Remove duplicates
      const uniqueConditions = Array.from(new Set(conditionsList));

      // Validate: If PATROL condition is used, patrolTimeThresholdHours must be set
      if (uniqueConditions.includes("PATROL")) {
        const roleConfig = currentConfig[role.id];
        if (!roleConfig.patrolTimeThresholdHours) {
          await cmdInteraction.reply({
            content: `❌ Cannot use PATROL condition without setting patrol time threshold. Use \`/role-tracking config set-threshold\` first.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      const roleConfig = {
        ...currentConfig[role.id],
        conditions: uniqueConditions,
      };

      const newConfig = {
        ...currentConfig,
        [role.id]: roleConfig,
      };

      // Validate configuration
      const validation = roleTrackingManager.validateRoleTrackingConfig(roleConfig);
      if (!validation.valid) {
        await cmdInteraction.reply({
          content: `❌ Configuration validation failed:\n${validation.errors.map((e) => `• ${e}`).join("\n")}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.guildSettings.update({
        where: { guildId: cmdInteraction.guildId },
        data: { roleTrackingConfig: newConfig as any },
      });

      await patrolTimer.logCommandUsage(
        cmdInteraction.guildId,
        "role-tracking-set-conditions",
        cmdInteraction.user.id,
        undefined,
        `${role.name} (${role.id}), ${uniqueConditions.join(", ")}`,
      );

      await cmdInteraction.reply({
        content: `✅ Conditions for <@&${role.id}> set to: ${uniqueConditions.join(", ")}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error("Error setting conditions", error);
      await cmdInteraction.reply({
        content: `❌ Failed to set conditions: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }


}
