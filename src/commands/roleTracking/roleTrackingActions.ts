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
  Role,
  User,
  AutocompleteInteraction,
  BaseInteraction,
} from "discord.js";
import { Pagination } from "@discordx/pagination";
import { patrolTimer, prisma, roleTrackingManager } from "../../main.js";
import { PermissionNodeGuard } from "../../utility/permissionNodes.js";
import { loggers } from "../../utility/logger.js";
import { ensureGuildMembersFetched } from "../../utility/guildMemberCache.js";
import type { RoleTrackingConfigMap } from "../../managers/roleTracking/roleTrackingManager.js";
import { msToDurationString, parseDurationToMs } from "../../utility/roleTracking/durationParser.js";

@Discord()
@SlashGroup({
  name: "role-tracking",
  description: "Role tracking",
})
@SlashGroup("role-tracking")
@Guard(PermissionNodeGuard("settings.command.role-tracking"))
export class RoleTrackingActionsCommands {
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

  @Slash({
    name: "manage",
    description: "Open role tracking manager UI",
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
          description += `\nUse \`/role-tracking config toggle-role\` to enable/disable.\n`;
          description += `Use \`/role-tracking config configure-warning\` to edit warnings.\n\n`;
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
    name: "reset-timer",
    description: "Reset user role timer",
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
      description: "Role (empty = all for user)",
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

    // Defer reply immediately after checking it's not autocomplete and it's in a guild
    await cmdInteraction.deferReply({ ephemeral: true });

    const role = roleId ? cmdInteraction.guild?.roles.cache.get(roleId) : null;

    // Check if roleId is provided but role is not found
    if (roleId && !role) {
      await cmdInteraction.editReply({
        content: "❌ Role not found.",
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

        await patrolTimer.logCommandUsage(
          cmdInteraction.guildId,
          "role-tracking-reset-timer",
          cmdInteraction.user.id,
          user.id,
          `role ${role?.name ?? roleId}`,
        );

        await cmdInteraction.editReply({
          content: `✅ Timer reset for <@${user.id}> for role <@&${roleId}>. All warnings have been removed.`,
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

        await patrolTimer.logCommandUsage(
          cmdInteraction.guildId,
          "role-tracking-reset-timer",
          cmdInteraction.user.id,
          user.id,
          "all roles",
        );

        await cmdInteraction.editReply({
          content: `✅ All timers reset for <@${user.id}>. All warnings have been removed.`,
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
      await cmdInteraction.editReply({
        content: `❌ Failed to reset timer: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({
    name: "sync-role-members",
    description: "Sync role members to tracking DB",
  })
  async syncRoleMembers(
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

    try {
      await cmdInteraction.deferReply({ flags: MessageFlags.Ephemeral });

      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: cmdInteraction.guildId },
        select: {
          loaRoleId: true,
          roleTrackingAdvisorRoleId: true,
          roleTrackingConfig: true,
          roleTrackingStaffChannelId: true,
        },
      });

      const guild = cmdInteraction.guild;
      if (!guild) {
        await cmdInteraction.editReply({
          content: "❌ Could not access guild information.",
        });
        return;
      }

      // Fetch all guild members to populate the cache
      // This ensures role.members contains all members with the role, not just cached ones
      await cmdInteraction.editReply({
        content: `⏳ Fetching guild members... This may take a moment for large servers.`,
      });
      await ensureGuildMembersFetched(guild);

      const role = guild.roles.cache.get(roleId);
      if (!role) {
        await cmdInteraction.editReply({
          content: `❌ Role not found. Please make sure the role exists and is configured for tracking.`,
        });
        return;
      }

      // Fetch all members with this role (now that cache is populated)
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

      // Find members not in database (excluding LOA/advisor roles)
      const membersToAdd: string[] = [];
      let excludedCount = 0;
      for (const member of membersWithRole.values()) {
        if (
          roleTrackingManager.isExcludedFromRoleTracking(
            member,
            settings?.loaRoleId,
            settings?.roleTrackingAdvisorRoleId,
          )
        ) {
          excludedCount++;
          continue;
        }
        if (!existingDiscordIds.has(member.id)) {
          membersToAdd.push(member.id);
        }
      }

      if (membersToAdd.length === 0) {
        const excludedNote =
          excludedCount > 0
            ? `\n• Excluded (LOA/advisor): ${excludedCount}`
            : "";
        await cmdInteraction.editReply({
          content: `✅ All eligible member(s) with role <@&${roleId}> are already in the database.${excludedNote}`,
        });
        return;
      }

      // Add all missing members to database with concurrency limiting
      let addedCount = 0;
      let failedCount = 0;
      const now = new Date();
      const guildId = cmdInteraction.guildId; // Already validated above

      // Simple concurrency limiter - process up to 10 members concurrently
      const concurrencyLimit = 10;
      const processMember = async (discordId: string): Promise<void> => {
        try {
          await roleTrackingManager.trackRoleAssignment(
            guildId,
            discordId,
            roleId,
            now,
          );
          addedCount++;
        } catch (error) {
          loggers.bot.error(`Failed to add user ${discordId} to database`, error);
          failedCount++;
        }
      };

      // Process members in batches with concurrency limit
      for (let i = 0; i < membersToAdd.length; i += concurrencyLimit) {
        const batch = membersToAdd.slice(i, i + concurrencyLimit);
        await Promise.all(batch.map(processMember));
      }

      // Log to staff channel if configured
      let roleChannelId: string | null | undefined = null;
      if (settings?.roleTrackingConfig) {
        const config = (settings.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};
        const roleConfig = config[roleId];
        if (roleConfig?.staffChannelId) {
          roleChannelId = roleConfig.staffChannelId;
        }
      }

      await patrolTimer.logCommandUsage(
        cmdInteraction.guildId,
        "role-tracking-sync-role-members",
        cmdInteraction.user.id,
        undefined,
        `${role.name} (${roleId}), added ${addedCount}`,
      );

      if (roleChannelId || settings?.roleTrackingStaffChannelId) {
        const logEmbed = new EmbedBuilder()
          .setTitle("🔄 Role Tracking Sync")
          .setDescription(
            `Synced members with role <@&${roleId}> by <@${cmdInteraction.user.id}>\n\n` +
            `**Results:**\n` +
            `• Total members with role: ${membersWithRole.size}\n` +
            `• Already in database: ${membersWithRole.size - membersToAdd.length - excludedCount}\n` +
            `• Added to database: ${addedCount}\n` +
            `${excludedCount > 0 ? `• Excluded (LOA/advisor): ${excludedCount}\n` : ""}` +
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
    description: "Cleanup warnings for left users",
  })
  async cleanup(
    @SlashOption({
      name: "all_users",
      description: "Cleanup all left users",
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

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "role-tracking-cleanup",
        interaction.user.id,
        undefined,
        `${cleanupCount} user(s)`,
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
    name: "list-users",
    description: "List tracked users for a role",
  })
  async listUsers(
    @SlashOption({
      name: "role",
      description: "Tracked role",
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
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/role-tracking config add-role\` first.`,
        });
        return;
      }

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
            take: 1,
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
    name: "view-conditions",
    description: "View conditions configured for a role",
  })
  async viewConditions(
    @SlashOption({
      name: "role",
      description: "Tracked role",
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
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/role-tracking config add-role\` first.`,
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
      description: "Tracked role",
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
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/role-tracking config add-role\` first.`,
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
        message = "**Default Template:** ✅ Embed template (supports placeholders)\n\nUse `/role-tracking config configure-staff-ping` to customize.";
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
    description: "Query user patrol time for role",
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
      await cmdInteraction.deferReply({ flags: MessageFlags.Ephemeral });

      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: cmdInteraction.guildId },
      });

      const config = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};

      if (!config[roleId]) {
        await cmdInteraction.editReply({
          content: `❌ Role <@&${roleId}> is not configured for tracking. Use \`/role-tracking config add-role\` first.`,
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

  @Slash({
    name: "list-warnings",
    description: "List all configured warnings for a role",
  })
  async listWarnings(
    @SlashOption({
      name: "role",
      description: "Tracked role",
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
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/role-tracking config add-role\` first.`,
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
      description: "Role (empty = all roles)",
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
}
