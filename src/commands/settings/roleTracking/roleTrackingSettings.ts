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
  User,
  ChannelType,
  Attachment,
  AutocompleteInteraction,
  BaseInteraction,
} from "discord.js";
import { Pagination } from "@discordx/pagination";
import { prisma } from "../../../main.js";
import { StaffGuard } from "../../../utility/guards.js";
import { loggers } from "../../../utility/logger.js";
import { roleTrackingManager } from "../../../main.js";
import type { RoleTrackingConfig, RoleTrackingConfigMap, CustomMessageData, ConditionType } from "../../../managers/roleTracking/roleTrackingManager.js";
import { parseDurationToMs, isValidDuration, msToDurationString } from "../../../utility/roleTracking/durationParser.js";

@Discord()
@SlashGroup({
  description: "Role tracking settings",
  name: "role-tracking",
  root: "settings",
})
@SlashGroup("role-tracking", "settings")
@Guard(StaffGuard)
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
   * Autocomplete handler for warning numbers
   */
  private async autocompleteWarningNumbers(interaction: AutocompleteInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.respond([]);
      return;
    }

    try {
      const roleOption = interaction.options.get("role");
      if (!roleOption || !roleOption.role) {
        // Role not selected yet, return empty
        await interaction.respond([]);
        return;
      }

      const roleId = roleOption.role.id;

      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      const config = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};
      const roleConfig = config[roleId];

      if (!roleConfig) {
        await interaction.respond([]);
        return;
      }

      const warnings = roleConfig.warnings || [];
      const focused = interaction.options.getFocused(true);
      const query = focused.value.toLowerCase();

      const choices = [];
      // Show existing warnings
      for (const warning of warnings.sort((a, b) => a.index - b.index)) {
        const warningNum = warning.index.toString();
        const name = `Warning #${warning.index + 1} (${warning.offset})`;
        
        if (warningNum.includes(query) || name.toLowerCase().includes(query) || query === "") {
          choices.push({
            name,
            value: warning.index.toString(),
          });
        }
      }
      
      // Always add option to create new warning
      if (choices.length < 25) {
        const newIndex = warnings.length > 0 
          ? Math.max(...warnings.map(w => w.index)) + 1
          : 0;
        const newName = `Warning #${newIndex + 1} (New)`;
        if (newIndex.toString().includes(query) || newName.toLowerCase().includes(query) || query === "") {
          choices.push({
            name: newName,
            value: newIndex.toString(),
          });
        }
      }

      await interaction.respond(choices.slice(0, 25));
    } catch (error) {
      loggers.bot.error("Error in autocomplete warning numbers", error);
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
  private getDefaultConfig(roleName: string, deadline: string, _roleId: string): RoleTrackingConfig {
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
      for (let i = 1; i < weeks; i++) {
        warnings.push({
          index: i - 1,
          offset: `${i} week${i > 1 ? "s" : ""}`,
          type: "warning",
          message: `Hello! This is your Week ${i} reminder for the {roleName} role. You have ${weeks - i} week${weeks - i > 1 ? "s" : ""} remaining. Make sure you're getting your patrol time in! If you need extended time, please request a Leave of Absence (LOA).`,
        });
      }

      return {
        enabled: true,
        roleName,
        deadlineDuration: deadline,
        conditions: [], // No conditions by default - must be specified
        patrolTimeThresholdHours: null,
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

      return {
        enabled: true,
        roleName,
        deadlineDuration: deadline,
        conditions: [], // No conditions by default - must be specified
        patrolTimeThresholdHours: null,
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
      description: "Deadline duration (e.g., '1 month', '3 months', '90 days')",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    deadline: string | null,
    @SlashOption({
      name: "conditions",
      description: "Conditions to check: PATROL, TIME, or both (optional, comma-separated)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: true,
    })
    conditionsInput: string | null,
    @SlashOption({
      name: "patrol_threshold_hours",
      description: "Minimum patrol time in hours to avoid warnings (required if PATROL condition is used)",
      type: ApplicationCommandOptionType.Number,
      required: false,
    })
    patrolThresholdHours: number | null,
    @SlashOption({
      name: "staff_channel",
      description: "Channel for staff notifications (optional, can be set separately)",
      type: ApplicationCommandOptionType.Channel,
      required: false,
    })
    staffChannel: GuildBasedChannel | null,
    @SlashOption({
      name: "staff_ping_channel",
      description: "Channel for staff pings (optional, falls back to staff_channel or guild setting)",
      type: ApplicationCommandOptionType.Channel,
      required: false,
    })
    staffPingChannel: GuildBasedChannel | null,
    @SlashOption({
      name: "staff_ping_roles",
      description: "Roles to ping (comma-separated role IDs/mentions, optional)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    staffPingRolesInput: string | null,
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
          
          const newDefaultConfig = this.getDefaultConfig(role.name, deadline, role.id);
          roleConfig.warnings = newDefaultConfig.warnings;
          roleConfig.staffPingOffset = newDefaultConfig.staffPingOffset;
          roleConfig.staffPingMessage = newDefaultConfig.staffPingMessage;
          
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
        roleConfig = this.getDefaultConfig(role.name, deadlineToUse, role.id);
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
    description: "Set the staff notification channel for role tracking",
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
    name: "set-role-staff-channel",
    description: "Set the staff notification channel for a specific role (overrides guild setting)",
  })
  async setRoleStaffChannel(
    @SlashOption({
      name: "role",
      description: "The role to set staff channel for",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    roleId: string,
    @SlashOption({
      name: "channel",
      description: "Channel for staff notifications (leave empty to use guild default)",
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
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/settings role-tracking add-role\` first.`,
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
          content: "ℹ️ No roles are configured for tracking yet. Use `/settings role-tracking add-role` to add one.",
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
        if (i === 0 && settings?.roleTrackingStaffChannelId) {
          const hasRoleSpecificChannels = pageRoles.some(([_, roleConfig]) => roleConfig.staffChannelId);
          if (!hasRoleSpecificChannels) {
            embed.addFields({
              name: "Guild Default Staff Channel",
              value: `<#${settings.roleTrackingStaffChannelId}>`,
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
    name: "manage",
    description: "Interactive role tracking management interface",
  })
  async manage(interaction: CommandInteraction): Promise<void> {
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
          content: "ℹ️ No roles are configured for tracking yet. Use `/settings role-tracking add-role` to add one.",
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
          const status = roleConfig.enabled ? "✅ Enabled" : "❌ Disabled";
          const threshold = roleConfig.patrolTimeThresholdHours
            ? `${roleConfig.patrolTimeThresholdHours} hours`
            : "Not set";
          
          const conditions = roleConfig.conditions || ["TIME"];
          description += `**<@&${roleId}>** - ${roleConfig.roleName}\n`;
          description += `Status: ${status}\n`;
          description += `Deadline: ${roleConfig.deadlineDuration}\n`;
          description += `Conditions: ${conditions.join(", ")}\n`;
          description += `Threshold: ${threshold}\n`;
          description += `Warnings: ${roleConfig.warnings.length}\n`;
          description += `Staff Ping: ${roleConfig.staffPingOffset}\n`;
          description += `\nUse \`/settings role-tracking toggle-role\` to enable/disable.\n`;
          description += `Use \`/settings role-tracking configure-warning\` to edit warnings.\n\n`;
        }

        const embed = new EmbedBuilder()
          .setTitle("Role Tracking Management")
          .setDescription(description || "No roles configured")
          .setColor(Colors.Blue)
          .setFooter({
            text: `Page ${Math.floor(i / pageSize) + 1} of ${Math.ceil(roles.length / pageSize)} • Use commands to manage roles`,
          })
          .setTimestamp();

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
      loggers.bot.error("Error in manage command", error);
      if (interaction.deferred) {
        await interaction.editReply({
          content: `❌ Failed to open management interface: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      } else {
        await interaction.reply({
          content: `❌ Failed to open management interface: ${error instanceof Error ? error.message : "Unknown error"}`,
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
      description: "The role to remove from tracking",
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
      description: "The role to toggle",
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
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/settings role-tracking add-role\` first.`,
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
    description: "Set or remove patrol time threshold for a role",
  })
  async setThreshold(
    @SlashOption({
      name: "role",
      description: "The role to set threshold for",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    roleId: string,
    @SlashOption({
      name: "threshold_hours",
      description: "Minimum patrol time in hours (leave empty to remove threshold)",
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
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/settings role-tracking add-role\` first.`,
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
    description: "Set which conditions to check for a role (PATROL, TIME, or both)",
  })
  async setConditions(
    @SlashOption({
      name: "role",
      description: "The role to set conditions for",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    roleId: string,
    @SlashOption({
      name: "conditions",
      description: "Conditions to check (PATROL, TIME, or both). Separate multiple with comma.",
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
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/settings role-tracking add-role\` first.`,
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
            content: `❌ Cannot use PATROL condition without setting patrol time threshold. Use \`/settings role-tracking set-threshold\` first.`,
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

  @Slash({
    name: "reset-timer",
    description: "Manually reset role assignment timer for a user",
  })
  async resetTimer(
    @SlashOption({
      name: "user",
      description: "The user to reset timer for",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "role",
      description: "The role to reset (leave empty to reset all roles for user)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: true,
    })
    roleId: string | null,
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

    const role = roleId ? cmdInteraction.guild?.roles.cache.get(roleId) : null;

    // Check if roleId is provided but role is not found
    if (roleId && !role) {
      await cmdInteraction.reply({
        content: "❌ Role not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const now = new Date();

      // Get or create user in database
      let dbUser = await prisma.user.findUnique({
        where: { discordId: user.id },
      });

      if (!dbUser) {
        dbUser = await prisma.user.create({
          data: { discordId: user.id },
        });
      }

      const userId = dbUser.id;

      if (role && roleId) {
        // Reset specific role
        await prisma.roleAssignmentTracking.updateMany({
          where: {
            guildId: cmdInteraction.guildId,
            userId,
            roleId,
          },
          data: {
            assignedAt: now,
            updatedAt: now,
          },
        });

        // Remove warnings for this user-role pair
        await roleTrackingManager.removeWarningsForUser(
          cmdInteraction.guildId,
          user.id, // discordId for manager method
          roleId,
        );

        await cmdInteraction.reply({
          content: `✅ Timer reset for <@${user.id}> for role <@&${roleId}>. All warnings have been removed.`,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        // Reset all roles for user
        await prisma.roleAssignmentTracking.updateMany({
          where: {
            guildId: cmdInteraction.guildId,
            userId,
          },
          data: {
            assignedAt: now,
            updatedAt: now,
          },
        });

        // Remove all warnings for this user
        await prisma.roleTrackingWarning.deleteMany({
          where: {
            guildId: cmdInteraction.guildId,
            userId,
          },
        });

        await cmdInteraction.reply({
          content: `✅ All timers reset for <@${user.id}>. All warnings have been removed.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // Log to staff channel
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: cmdInteraction.guildId },
        select: { roleTrackingConfig: true, roleTrackingStaffChannelId: true },
      });

      // Get role-specific channel if roleId is provided
      let roleChannelId: string | null | undefined = null;
      if (roleId && settings?.roleTrackingConfig) {
        const config = (settings.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};
        const roleConfig = config[roleId];
        if (roleConfig?.staffChannelId) {
          roleChannelId = roleConfig.staffChannelId;
        }
      }

      // Only log if there's a channel configured (role-specific or guild-level)
      if (roleChannelId || settings?.roleTrackingStaffChannelId) {
        const logEmbed = new EmbedBuilder()
          .setTitle("🔄 Role Tracking Timer Reset")
          .setDescription(
            `Timer reset for <@${user.id}>${roleId ? ` for role <@&${roleId}>` : " (all roles)"} by <@${cmdInteraction.user.id}>`,
          )
          .setColor(Colors.Orange)
          .setTimestamp();

        await roleTrackingManager.logToStaffChannel(
          cmdInteraction.guildId,
          logEmbed,
          false,
          roleChannelId,
        );
      }
    } catch (error) {
      loggers.bot.error("Error resetting timer", error);
      await cmdInteraction.reply({
        content: `❌ Failed to reset timer: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "sync-role-members",
    description: "Add all members with a role to the database (if not already tracked)",
  })
  async syncRoleMembers(
    @SlashOption({
      name: "role",
      description: "The role to sync members for",
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

    try {
      await cmdInteraction.deferReply({ flags: MessageFlags.Ephemeral });

      const guild = cmdInteraction.guild;
      if (!guild) {
        await cmdInteraction.editReply({
          content: "❌ Could not access guild information.",
        });
        return;
      }

      const role = guild.roles.cache.get(roleId);
      if (!role) {
        await cmdInteraction.editReply({
          content: `❌ Role not found. Please make sure the role exists and is configured for tracking.`,
        });
        return;
      }

      // Fetch all members with this role
      const membersWithRole = role.members;
      if (membersWithRole.size === 0) {
        await cmdInteraction.editReply({
          content: `ℹ️ No members found with role <@&${roleId}>.`,
        });
        return;
      }

      // Get all existing assignments for this role in this guild with user discordIds
      const existingAssignments = await prisma.roleAssignmentTracking.findMany({
        where: {
          guildId: cmdInteraction.guildId,
          roleId: roleId,
        },
        include: {
          user: {
            select: {
              discordId: true,
            },
          },
        },
      });

      const existingDiscordIds = new Set(
        existingAssignments.map((a) => a.user.discordId),
      );

      // Find members not in database
      const membersToAdd: string[] = [];
      for (const member of membersWithRole.values()) {
        if (!existingDiscordIds.has(member.id)) {
          membersToAdd.push(member.id);
        }
      }

      if (membersToAdd.length === 0) {
        await cmdInteraction.editReply({
          content: `✅ All ${membersWithRole.size} member(s) with role <@&${roleId}> are already in the database.`,
        });
        return;
      }

      // Add all missing members to database
      let addedCount = 0;
      let failedCount = 0;
      const now = new Date();

      for (const discordId of membersToAdd) {
        try {
          await roleTrackingManager.trackRoleAssignment(
            cmdInteraction.guildId,
            discordId,
            roleId,
            now,
          );
          addedCount++;
        } catch (error) {
          loggers.bot.error(`Failed to add user ${discordId} to database`, error);
          failedCount++;
        }
      }

      // Log to staff channel if configured
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: cmdInteraction.guildId },
        select: { roleTrackingConfig: true, roleTrackingStaffChannelId: true },
      });

      let roleChannelId: string | null | undefined = null;
      if (settings?.roleTrackingConfig) {
        const config = (settings.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};
        const roleConfig = config[roleId];
        if (roleConfig?.staffChannelId) {
          roleChannelId = roleConfig.staffChannelId;
        }
      }

      if (roleChannelId || settings?.roleTrackingStaffChannelId) {
        const logEmbed = new EmbedBuilder()
          .setTitle("🔄 Role Tracking Sync")
          .setDescription(
            `Synced members with role <@&${roleId}> by <@${cmdInteraction.user.id}>\n\n` +
            `**Results:**\n` +
            `• Total members with role: ${membersWithRole.size}\n` +
            `• Already in database: ${membersWithRole.size - membersToAdd.length}\n` +
            `• Added to database: ${addedCount}\n` +
            `${failedCount > 0 ? `• Failed: ${failedCount}\n` : ""}`,
          )
          .setColor(addedCount > 0 ? Colors.Green : Colors.Orange)
          .setTimestamp();

        await roleTrackingManager.logToStaffChannel(
          cmdInteraction.guildId,
          logEmbed,
          false,
          roleChannelId,
        );
      }

      let resultMessage = `✅ Sync completed for role <@&${roleId}>:\n`;
      resultMessage += `• Total members: ${membersWithRole.size}\n`;
      resultMessage += `• Already tracked: ${membersWithRole.size - membersToAdd.length}\n`;
      resultMessage += `• Added: ${addedCount}`;
      if (failedCount > 0) {
        resultMessage += `\n• Failed: ${failedCount}`;
      }

      await cmdInteraction.editReply({
        content: resultMessage,
      });
    } catch (error) {
      loggers.bot.error("Error syncing role members", error);
      await cmdInteraction.editReply({
        content: `❌ Failed to sync role members: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({
    name: "cleanup",
    description: "Cleanup warnings for users who have left",
  })
  async cleanup(
    @SlashOption({
      name: "all_users",
      description: "If true, cleanup all left users (default: false)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    _allUsers: boolean | null,
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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const cleanupCount = await roleTrackingManager.cleanupWarningsForMissingUsers(
        interaction.guildId,
      );

      await interaction.editReply({
        content: `✅ Cleanup completed. Removed tracking data for ${cleanupCount} user(s) who have left the server.`,
      });
    } catch (error) {
      loggers.bot.error("Error cleaning up warnings", error);
      await interaction.editReply({
        content: `❌ Failed to cleanup: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({
    name: "configure-warning",
    description: "Configure a warning message and timing",
  })
  async configureWarning(
    @SlashOption({
      name: "role",
      description: "The role to configure warning for",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    role: Role,
    @SlashOption({
      name: "offset",
      description: "Warning offset (e.g., '1 week', '2 months')",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    offset: string,
    @SlashOption({
      name: "warning_number",
      description: "Warning number (0-based index). If not provided, adds a new warning.",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: true,
    })
    warningNumberStr: string | null,
    @SlashOption({
      name: "message",
      description: "Warning message (can use placeholders: {roleName}, {timeRemaining}, {patrolTimeHours})",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    message: string | null,
    @SlashOption({
      name: "message_json",
      description: "JSON embed data (embeds + components) - overrides message if provided",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    messageJson: string | null,
    @SlashOption({
      name: "message_file",
      description: "JSON file attachment containing embed data (if text is too large)",
      type: ApplicationCommandOptionType.Attachment,
      required: false,
    })
    messageFile: Attachment | null,
    interaction: BaseInteraction,
  ): Promise<void> {
    if (interaction.isAutocomplete()) {
      const autoInteraction = interaction as AutocompleteInteraction;
      const focused = autoInteraction.options.getFocused(true);
      if (focused.name === "warning_number") {
        return this.autocompleteWarningNumbers(autoInteraction);
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

    // Defer reply as soon as we know it's not autocomplete and it's in a guild
    await cmdInteraction.deferReply({ ephemeral: true });

    const warningNumber = warningNumberStr !== null ? parseInt(warningNumberStr, 10) : null;

    try {
      if (warningNumber !== null && (isNaN(warningNumber) || warningNumber < 0)) {
        await cmdInteraction.editReply({
          content: "❌ Warning number must be 0 or greater.",
        });
        return;
      }

      if (!isValidDuration(offset)) {
        await cmdInteraction.editReply({
          content: `❌ Invalid offset format: "${offset}". Use formats like "1 week", "2 months", etc.`,
        });
        return;
      }

      // Validate that either message or message_json/message_file is provided
      if (!message && !messageJson && !messageFile) {
        await cmdInteraction.editReply({
          content: "❌ Either 'message', 'message_json', or 'message_file' must be provided.",
        });
        return;
      }

      // Parse custom message data if provided
      let customMessageData: CustomMessageData | null = null;
      if (messageFile) {
        try {
          const fileContent = await fetch(messageFile.url).then((res) => res.text());
          customMessageData = JSON.parse(fileContent);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await cmdInteraction.editReply({
            content: `❌ Failed to parse JSON from file attachment: ${errorMessage}`,
          });
          return;
        }
      } else if (messageJson) {
        try {
          customMessageData = JSON.parse(messageJson);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await cmdInteraction.editReply({
            content: `❌ Failed to parse JSON: ${errorMessage}`,
          });
          return;
        }
      }

      // Validate JSON structure if custom message data is provided
      if (customMessageData) {
        if (!customMessageData.embeds && !customMessageData.components) {
          await cmdInteraction.editReply({
            content: "❌ JSON must contain at least 'embeds' or 'components'",
          });
          return;
        }
        if (customMessageData.embeds && !Array.isArray(customMessageData.embeds)) {
          await cmdInteraction.editReply({
            content: "❌ 'embeds' must be an array",
          });
          return;
        }
        if (customMessageData.components && !Array.isArray(customMessageData.components)) {
          await cmdInteraction.editReply({
            content: "❌ 'components' must be an array",
          });
          return;
        }
      }

      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: cmdInteraction.guildId },
      });

      const currentConfig = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (!currentConfig[role.id]) {
        await cmdInteraction.editReply({
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/settings role-tracking add-role\` first.`,
        });
        return;
      }

      const roleConfig = currentConfig[role.id];
      const deadlineMs = parseDurationToMs(roleConfig.deadlineDuration);
      const offsetMs = parseDurationToMs(offset);

      if (!deadlineMs || !offsetMs) {
        await cmdInteraction.editReply({
          content: "❌ Failed to parse durations.",
        });
        return;
      }

      if (offsetMs > deadlineMs) {
        await cmdInteraction.editReply({
          content: `❌ Warning offset "${offset}" exceeds deadline "${roleConfig.deadlineDuration}".`,
        });
        return;
      }

      // Update or add warning
      const warnings = [...roleConfig.warnings];
      
      // Determine warning index
      let finalWarningNumber: number;
      if (warningNumber !== null) {
        // User specified a number - use it to replace or add at that index
        finalWarningNumber = warningNumber;
      } else {
        // Auto-assign next sequential number
        const maxIndex = warnings.length > 0 
          ? Math.max(...warnings.map(w => w.index))
          : -1;
        finalWarningNumber = maxIndex + 1;
      }

      const existingIndex = warnings.findIndex((w) => w.index === finalWarningNumber);

      const warningData: any = {
        index: finalWarningNumber,
        offset,
        type: "warning",
        message: message || "", // Keep message for backward compatibility
      };

      // Add custom message data if provided
      if (customMessageData) {
        warningData.customMessage = customMessageData;
      }

      if (existingIndex >= 0) {
        warnings[existingIndex] = warningData;
      } else {
        warnings.push(warningData);
        warnings.sort((a, b) => a.index - b.index);
      }

      const newConfig = {
        ...currentConfig,
        [role.id]: {
          ...roleConfig,
          warnings,
        },
      };

      // Validate configuration
      const validation = roleTrackingManager.validateRoleTrackingConfig(newConfig[role.id]);
      if (!validation.valid) {
        await cmdInteraction.editReply({
          content: `❌ Configuration validation failed:\n${validation.errors.map((e) => `• ${e}`).join("\n")}`,
        });
        return;
      }

      await prisma.guildSettings.update({
        where: { guildId: cmdInteraction.guildId },
        data: { roleTrackingConfig: newConfig as any },
      });

      const action = existingIndex >= 0 ? "updated" : "added";
      await cmdInteraction.editReply({
        content: `✅ Warning #${finalWarningNumber} ${action} for <@&${role.id}> at offset ${offset}.`,
      });
    } catch (error) {
      loggers.bot.error("Error configuring warning", error);
      if (cmdInteraction.deferred) {
        await cmdInteraction.editReply({
          content: `❌ Failed to configure warning: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      } else {
        await cmdInteraction.reply({
          content: `❌ Failed to configure warning: ${error instanceof Error ? error.message : "Unknown error"}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  @Slash({
    name: "configure-staff-ping",
    description: "Configure custom staff ping message (embeds/components)",
  })
  async configureStaffPing(
    @SlashOption({
      name: "role",
      description: "The role to configure staff ping for",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    role: Role,
    @SlashOption({
      name: "message_json",
      description: "JSON embed data (embeds + components)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    messageJson: string | null,
    @SlashOption({
      name: "message_file",
      description: "JSON file attachment containing embed data (if text is too large)",
      type: ApplicationCommandOptionType.Attachment,
      required: false,
    })
    messageFile: Attachment | null,
    @SlashOption({
      name: "clear",
      description: "Clear custom staff ping message (use default template)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clear: boolean | null,
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
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      const currentConfig = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (!currentConfig[role.id]) {
        await interaction.reply({
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/settings role-tracking add-role\` first.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const roleConfig = currentConfig[role.id];

      // Handle clear
      if (clear) {
        const newConfig = {
          ...currentConfig,
          [role.id]: {
            ...roleConfig,
            customStaffPingMessage: undefined,
          },
        };

        await prisma.guildSettings.update({
          where: { guildId: interaction.guildId },
          data: { roleTrackingConfig: newConfig as any },
        });

        await interaction.reply({
          content: `✅ Custom staff ping message cleared for <@&${role.id}>. Default template will be used.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Validate that message_json or message_file is provided
      if (!messageJson && !messageFile) {
        await interaction.reply({
          content: "❌ Either 'message_json' or 'message_file' must be provided (or use 'clear' to remove custom message).",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Defer reply before long-running operations
      await interaction.deferReply({ ephemeral: true });

      // Parse custom message data
      let customMessageData: CustomMessageData | null = null;
      if (messageFile) {
        try {
          const fileContent = await fetch(messageFile.url).then((res) => res.text());
          customMessageData = JSON.parse(fileContent);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await interaction.editReply({
            content: `❌ Failed to parse JSON from file attachment: ${errorMessage}`,
          });
          return;
        }
      } else if (messageJson) {
        try {
          customMessageData = JSON.parse(messageJson);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await interaction.editReply({
            content: `❌ Failed to parse JSON: ${errorMessage}`,
          });
          return;
        }
      }

      // Validate JSON structure
      if (customMessageData) {
        if (!customMessageData.embeds && !customMessageData.components) {
          await interaction.editReply({
            content: "❌ JSON must contain at least 'embeds' or 'components'",
          });
          return;
        }
        if (customMessageData.embeds && !Array.isArray(customMessageData.embeds)) {
          await interaction.editReply({
            content: "❌ 'embeds' must be an array",
          });
          return;
        }
        if (customMessageData.components && !Array.isArray(customMessageData.components)) {
          await interaction.editReply({
            content: "❌ 'components' must be an array",
          });
          return;
        }
      }

      const newConfig = {
        ...currentConfig,
        [role.id]: {
          ...roleConfig,
          customStaffPingMessage: customMessageData,
        },
      };

      await prisma.guildSettings.update({
        where: { guildId: interaction.guildId },
        data: { roleTrackingConfig: newConfig as any },
      });

      await interaction.editReply({
        content: `✅ Custom staff ping message configured for <@&${role.id}>.`,
      });
    } catch (error) {
      loggers.bot.error("Error configuring staff ping", error);
      if (interaction.deferred) {
        await interaction.editReply({
          content: `❌ Failed to configure staff ping: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      } else {
        await interaction.reply({
          content: `❌ Failed to configure staff ping: ${error instanceof Error ? error.message : "Unknown error"}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  @Slash({
    name: "list-warnings",
    description: "List all configured warnings for a role",
  })
  async listWarnings(
    @SlashOption({
      name: "role",
      description: "The role to list warnings for",
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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      const config = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (!config[role.id]) {
        await interaction.editReply({
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/settings role-tracking add-role\` first.`,
        });
        return;
      }

      const roleConfig = config[role.id];
      const warnings = roleConfig.warnings || [];

      if (warnings.length === 0) {
        await interaction.editReply({
          content: `ℹ️ No warnings configured for <@&${role.id}>.`,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Warnings for ${roleConfig.roleName}`)
        .setDescription(`Role: <@&${role.id}>`)
        .setColor(Colors.Blue)
        .setTimestamp();

      for (const warning of warnings.sort((a, b) => a.index - b.index)) {
        const messagePreview = warning.message.length > 100 
          ? warning.message.substring(0, 100) + "..." 
          : warning.message;
        
        embed.addFields({
          name: `Warning #${warning.index + 1} (${warning.offset})`,
          value: `**Type:** ${warning.type}\n**Message:** ${messagePreview}${warning.customMessage ? "\n**Custom Message:** ✅ Yes" : ""}`,
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      loggers.bot.error("Error listing warnings", error);
      await interaction.editReply({
        content: `❌ Failed to list warnings: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({
    name: "list-users",
    description: "List all users being tracked for a role",
  })
  async listUsers(
    @SlashOption({
      name: "role",
      description: "The role to list users for",
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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      const config = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (!config[role.id]) {
        await interaction.editReply({
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/settings role-tracking add-role\` first.`,
        });
        return;
      }

      // Get all tracked users for this role
      const assignments = await prisma.roleAssignmentTracking.findMany({
        where: {
          guildId: interaction.guildId,
          roleId: role.id,
        },
        include: {
          user: true,
          warnings: {
            orderBy: {
              sentAt: "desc",
            },
            take: 1, // Get most recent warning
          },
        },
        orderBy: {
          assignedAt: "asc",
        },
      });

      if (assignments.length === 0) {
        await interaction.editReply({
          content: `ℹ️ No users are currently being tracked for <@&${role.id}>.`,
        });
        return;
      }

      const roleConfig = config[role.id];
      const deadlineMs = parseDurationToMs(roleConfig.deadlineDuration) || 0;
      const now = new Date();

      const pageSize = 10;
      const pages: Array<{ embeds: EmbedBuilder[] }> = [];

      for (let i = 0; i < assignments.length; i += pageSize) {
        const pageAssignments = assignments.slice(i, i + pageSize);
        let description = "";

        for (const assignment of pageAssignments) {
          const timeSinceAssignment = now.getTime() - assignment.assignedAt.getTime();
          const timeRemaining = deadlineMs - timeSinceAssignment;
          const timeRemainingStr = timeRemaining > 0 ? msToDurationString(timeRemaining) : "⚠️ Overdue";
          
          const lastWarning = assignment.warnings[0];
          const warningInfo = lastWarning 
            ? `Last warning: ${lastWarning.sentAt.toLocaleDateString()} (#${lastWarning.warningIndex + 1})`
            : "No warnings sent";

          description += `<@${assignment.user.discordId}>\n`;
          description += `  • Assigned: ${assignment.assignedAt.toLocaleDateString()}\n`;
          description += `  • Time Remaining: ${timeRemainingStr}\n`;
          description += `  • ${warningInfo}\n\n`;
        }

        const embed = new EmbedBuilder()
          .setTitle(`Tracked Users for ${roleConfig.roleName}`)
          .setDescription(description || "No users")
          .setColor(Colors.Blue)
          .setFooter({
            text: `Page ${Math.floor(i / pageSize) + 1} of ${Math.ceil(assignments.length / pageSize)} • Total: ${assignments.length} user(s)`,
          })
          .setTimestamp();

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
      loggers.bot.error("Error listing users", error);
      await interaction.editReply({
        content: `❌ Failed to list users: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({
    name: "list-warning-history",
    description: "List warning history for a user and role",
  })
  async listWarningHistory(
    @SlashOption({
      name: "user",
      description: "The user to list warning history for",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "role",
      description: "The role (leave empty to show all roles)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: true,
    })
    roleId: string | null,
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

    try {
      await cmdInteraction.deferReply({ flags: MessageFlags.Ephemeral });

      const dbUser = await prisma.user.findUnique({
        where: { discordId: user.id },
      });

      if (!dbUser) {
        await cmdInteraction.editReply({
          content: `ℹ️ User <@${user.id}> has no tracking records.`,
        });
        return;
      }

      const where: {
        guildId: string;
        userId: number;
        roleId?: string;
      } = {
        guildId: cmdInteraction.guildId,
        userId: dbUser.id,
      };

      if (roleId) {
        where.roleId = roleId;
      }

      const warnings = await prisma.roleTrackingWarning.findMany({
        where,
        include: {
          assignmentTracking: true,
        },
        orderBy: {
          sentAt: "desc",
        },
      });

      if (warnings.length === 0) {
        await cmdInteraction.editReply({
          content: `ℹ️ No warning history found for <@${user.id}>${roleId ? ` for role <@&${roleId}>` : ""}.`,
        });
        return;
      }

      const pageSize = 10;
      const pages: Array<{ embeds: EmbedBuilder[] }> = [];

      for (let i = 0; i < warnings.length; i += pageSize) {
        const pageWarnings = warnings.slice(i, i + pageSize);
        let description = "";

        for (const warning of pageWarnings) {
          const roleMention = `<@&${warning.roleId}>`;
          const warningType = warning.warningType === "staff_ping" ? "🚨 Staff Ping" : `⚠️ Warning #${warning.warningIndex + 1}`;
          
          description += `${warningType} - ${roleMention}\n`;
          description += `  • Sent: ${warning.sentAt.toLocaleString()}\n`;
          description += `  • Role Assigned: ${warning.roleAssignedAt.toLocaleDateString()}\n\n`;
        }

        const embed = new EmbedBuilder()
          .setTitle(`Warning History for ${user.displayName || user.username}`)
          .setDescription(description || "No warnings")
          .setColor(Colors.Orange)
          .setFooter({
            text: `Page ${Math.floor(i / pageSize) + 1} of ${Math.ceil(warnings.length / pageSize)} • Total: ${warnings.length} warning(s)`,
          })
          .setTimestamp();

        pages.push({ embeds: [embed] });
      }

      if (pages.length === 1) {
        await cmdInteraction.editReply(pages[0]);
        return;
      }

      const pagination = new Pagination(cmdInteraction, pages, {
        ephemeral: true,
        time: 120_000,
      });

      await pagination.send();
    } catch (error) {
      loggers.bot.error("Error listing warning history", error);
      await cmdInteraction.editReply({
        content: `❌ Failed to list warning history: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({
    name: "view-conditions",
    description: "View conditions configured for a role",
  })
  async viewConditions(
    @SlashOption({
      name: "role",
      description: "The role to view conditions for",
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
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      const config = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (!config[role.id]) {
        await interaction.reply({
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/settings role-tracking add-role\` first.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const roleConfig = config[role.id];
      const conditions = roleConfig.conditions || ["TIME"];

      const embed = new EmbedBuilder()
        .setTitle(`Conditions for ${roleConfig.roleName}`)
        .setDescription(`Role: <@&${role.id}>`)
        .addFields(
          {
            name: "Conditions",
            value: conditions.join(", ") || "None",
            inline: false,
          },
          {
            name: "PATROL Condition",
            value: conditions.includes("PATROL") 
              ? `✅ Enabled\nThreshold: ${roleConfig.patrolTimeThresholdHours || "Not set"} hours`
              : "❌ Disabled",
            inline: true,
          },
          {
            name: "TIME Condition",
            value: conditions.includes("TIME")
              ? `✅ Enabled\nDeadline: ${roleConfig.deadlineDuration}`
              : "❌ Disabled",
            inline: true,
          },
        )
        .setColor(Colors.Blue)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      loggers.bot.error("Error viewing conditions", error);
      await interaction.reply({
        content: `❌ Failed to view conditions: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "view-staff-ping",
    description: "View staff ping message configuration for a role",
  })
  async viewStaffPing(
    @SlashOption({
      name: "role",
      description: "The role to view staff ping for",
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
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      const config = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (!config[role.id]) {
        await interaction.reply({
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/settings role-tracking add-role\` first.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const roleConfig = config[role.id];
      const hasCustomMessage = !!roleConfig.customStaffPingMessage;
      const isEmbedTemplate = typeof roleConfig.staffPingMessage === "object";
      
      let message: string;
      if (hasCustomMessage) {
        message = "**Custom Message:** ✅ Configured (embeds/components)";
      } else if (isEmbedTemplate) {
        message = "**Default Template:** ✅ Embed template (supports placeholders)\n\nUse `/settings role-tracking configure-staff-ping` to customize.";
      } else {
        message = `**Default Template (Legacy String):**\n\`\`\`\n${roleConfig.staffPingMessage}\`\`\``;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Staff Ping Configuration for ${roleConfig.roleName}`)
        .setDescription(`Role: <@&${role.id}>`)
        .addFields(
          {
            name: "Message Type",
            value: hasCustomMessage ? "Custom (JSON)" : isEmbedTemplate ? "Default Embed Template" : "Default String Template",
            inline: true,
          },
          {
            name: "Offset",
            value: roleConfig.staffPingOffset,
            inline: true,
          },
          {
            name: "Message",
            value: message,
            inline: false,
          },
        )
        .setColor(Colors.Blue)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      loggers.bot.error("Error viewing staff ping", error);
      await interaction.reply({
        content: `❌ Failed to view staff ping: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "query-patrol-time",
    description: "Query patrol time for a user in a role period",
  })
  async queryPatrolTime(
    @SlashOption({
      name: "user",
      description: "The user to query patrol time for",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "role",
      description: "The role to query patrol time for",
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
      await cmdInteraction.deferReply({ flags: MessageFlags.Ephemeral });

      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: cmdInteraction.guildId },
      });

      const config = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (!config[roleId]) {
        await cmdInteraction.editReply({
          content: `❌ Role <@&${roleId}> is not configured for tracking. Use \`/settings role-tracking add-role\` first.`,
        });
        return;
      }

      const dbUser = await prisma.user.findUnique({
        where: { discordId: user.id },
      });

      if (!dbUser) {
        await cmdInteraction.editReply({
          content: `ℹ️ User <@${user.id}> has no tracking records.`,
        });
        return;
      }

      // Get assignment date
      const assignment = await prisma.roleAssignmentTracking.findUnique({
        where: {
          guildId_userId_roleId: {
            guildId: cmdInteraction.guildId,
            userId: dbUser.id,
            roleId,
          },
        },
      });

      if (!assignment) {
        await cmdInteraction.editReply({
          content: `ℹ️ User <@${user.id}> is not being tracked for role <@&${roleId}>.`,
        });
        return;
      }

      // Get patrol time
      const now = new Date();
      const patrolTimeMs = await roleTrackingManager.getUserPatrolTimeInPeriod(
        cmdInteraction.guildId,
        user.id,
        assignment.assignedAt,
        now,
      );

      const patrolTimeHours = patrolTimeMs / (1000 * 60 * 60);
      const roleConfig = config[roleId];
      const thresholdMet = roleConfig.patrolTimeThresholdHours 
        ? patrolTimeHours >= roleConfig.patrolTimeThresholdHours 
        : null;

      const timeSinceAssignment = now.getTime() - assignment.assignedAt.getTime();
      const deadlineMs = parseDurationToMs(roleConfig.deadlineDuration) || 0;
      const timeRemaining = deadlineMs - timeSinceAssignment;
      const timeRemainingStr = timeRemaining > 0 ? msToDurationString(timeRemaining) : "⚠️ Overdue";

      const embed = new EmbedBuilder()
        .setTitle(`Patrol Time Query for ${user.displayName || user.username}`)
        .setDescription(`Role: <@&${roleId}> (${roleConfig.roleName})`)
        .addFields(
          {
            name: "User",
            value: `<@${user.id}>`,
            inline: true,
          },
          {
            name: "Role Assigned",
            value: assignment.assignedAt.toLocaleString(),
            inline: true,
          },
          {
            name: "Patrol Time",
            value: `${patrolTimeHours.toFixed(2)} hours\n(${msToDurationString(patrolTimeMs)})`,
            inline: true,
          },
          {
            name: "Threshold",
            value: roleConfig.patrolTimeThresholdHours 
              ? `${roleConfig.patrolTimeThresholdHours} hours`
              : "Not set",
            inline: true,
          },
          {
            name: "Threshold Status",
            value: thresholdMet === null 
              ? "N/A"
              : thresholdMet 
                ? "✅ Met"
                : "❌ Not Met",
            inline: true,
          },
          {
            name: "Time Remaining",
            value: timeRemainingStr,
            inline: true,
          },
        )
        .setColor(thresholdMet === false ? Colors.Red : thresholdMet === true ? Colors.Green : Colors.Blue)
        .setTimestamp();

      await cmdInteraction.editReply({ embeds: [embed] });
    } catch (error) {
      loggers.bot.error("Error querying patrol time", error);
      await cmdInteraction.editReply({
        content: `❌ Failed to query patrol time: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }
}
