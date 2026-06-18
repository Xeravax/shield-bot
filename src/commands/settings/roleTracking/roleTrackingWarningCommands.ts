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
  Attachment,
  AutocompleteInteraction,
  BaseInteraction,
} from "discord.js";
import { Pagination } from "@discordx/pagination";
import { patrolTimer, prisma, roleTrackingManager } from "../../../main.js";
import { StaffGuard } from "../../../utility/guards.js";
import { loggers } from "../../../utility/logger.js";
import type { RoleTrackingConfigMap, CustomMessageData } from "../../../managers/roleTracking/roleTrackingManager.js";
import { parseDurationToMs, isValidDuration } from "../../../utility/roleTracking/durationParser.js";

@Discord()
@SlashGroup({
  name: "role-tracking",
  description: "Role tracking",
})
@SlashGroup({
  name: "settings",
  description: "Settings",
  root: "role-tracking",
})
@SlashGroup("settings", "role-tracking")
@Guard(StaffGuard)
export class SettingsRoleTrackingWarnCommands {

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
          choices.push({ name: `${role.name} (${roleConfig.roleName})`, value: roleId });
        }
      }
      await interaction.respond(choices.slice(0, 25));
    } catch (error) {
      loggers.bot.error("Error in autocomplete tracked roles", error);
      await interaction.respond([]);
    }
  }

  private async autocompleteWarningNumbers(interaction: AutocompleteInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.respond([]);
      return;
    }
    try {
      const roleOption = interaction.options.get("role");
      if (!roleOption?.role) {
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
      for (const warning of warnings.sort((a, b) => a.index - b.index)) {
        const warningNum = warning.index.toString();
        const name = `Warning #${warning.index + 1} (${warning.offset})`;
        if (warningNum.includes(query) || name.toLowerCase().includes(query) || query === "") {
          choices.push({ name, value: warning.index.toString() });
        }
      }
      if (choices.length < 25) {
        const newIndex =
          warnings.length > 0 ? Math.max(...warnings.map((w) => w.index)) + 1 : 0;
        const newName = `Warning #${newIndex + 1} (New)`;
        if (
          newIndex.toString().includes(query) ||
          newName.toLowerCase().includes(query) ||
          query === ""
        ) {
          choices.push({ name: newName, value: newIndex.toString() });
        }
      }
      await interaction.respond(choices.slice(0, 25));
    } catch (error) {
      loggers.bot.error("Error in autocomplete warning numbers", error);
      await interaction.respond([]);
    }
  }

  @Slash({
    name: "configure-warning",
    description: "Configure a warning message and timing",
  })
  async configureWarning(
    @SlashOption({
      name: "role",
      description: "Tracked role",
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
      description: "Warning index (empty = new)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: true,
    })
    warningNumberStr: string | null,
    @SlashOption({
      name: "message",
      description: "Warning message text",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    message: string | null,
    @SlashOption({
      name: "message_json",
      description: "JSON embed data",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    messageJson: string | null,
    @SlashOption({
      name: "message_file",
      description: "JSON file with embed data",
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
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/role-tracking settings add-role\` first.`,
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

      await patrolTimer.logCommandUsage(
        cmdInteraction.guildId,
        "role-tracking-configure-warning",
        cmdInteraction.user.id,
        undefined,
        `${role.name} (${role.id}), warning #${finalWarningNumber} at ${offset}`,
      );

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
    description: "Configure staff ping message",
  })
  async configureStaffPing(
    @SlashOption({
      name: "role",
      description: "Tracked role",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    role: Role,
    @SlashOption({
      name: "message_json",
      description: "JSON embed data",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    messageJson: string | null,
    @SlashOption({
      name: "message_file",
      description: "JSON file with embed data",
      type: ApplicationCommandOptionType.Attachment,
      required: false,
    })
    messageFile: Attachment | null,
    @SlashOption({
      name: "clear",
      description: "Clear custom staff ping",
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
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/role-tracking settings add-role\` first.`,
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

        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "role-tracking-configure-staff-ping",
          interaction.user.id,
          undefined,
          `${role.name} (${role.id}), cleared`,
        );

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

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "role-tracking-configure-staff-ping",
        interaction.user.id,
        undefined,
        `${role.name} (${role.id})`,
      );

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
          content: `❌ Role <@&${role.id}> is not configured for tracking. Use \`/role-tracking settings add-role\` first.`,
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
