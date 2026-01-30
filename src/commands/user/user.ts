import { Discord, Slash, SlashGroup, SlashOption, Guard, SlashChoice } from "discordx";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
  User,
  Role,
  EmbedBuilder,
  PermissionFlagsBits,
  GuildMember,
} from "discord.js";
import { Pagination } from "@discordx/pagination";
import {
  getUserPermissionLevelFromRoles,
  PermissionLevel,
} from "../../utility/permissionUtils.js";
import { loggers } from "../../utility/logger.js";
import { GuildGuard, StaffGuard } from "../../utility/guards.js";
import { getUserExportData } from "../../utility/userDataExport.js";

@Discord()
@SlashGroup({
  name: "user",
  description: "User management commands",
})
@SlashGroup("user")
export class UserCommands {
  @Slash({
    name: "export",
    description: "Export your own data stored by the bot (JSON file).",
  })
  async export(interaction: CommandInteraction): Promise<void> {
    try {
      const payload = await getUserExportData(interaction.user.id);
      if (!payload) {
        await interaction.reply({
          content: "You have no data stored.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const jsonString = JSON.stringify(payload, null, 2);
      await interaction.reply({
        files: [
          {
            attachment: Buffer.from(jsonString, "utf-8"),
            name: "my-shield-bot-data.json",
          },
        ],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error("Error exporting user data", error);
      const content =
        interaction.replied || interaction.deferred
          ? "Failed to export your data. Please try again later."
          : "Failed to export your data. Please try again later.";
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ content }).catch(() => {});
        } else {
          await interaction.reply({
            content,
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  @Slash({
    name: "permission",
    description: "Check user permissions or list all permission levels.",
  })
  @Guard(GuildGuard)
  async permission(
    @SlashOption({
      name: "user",
      description: "User to check (optional, if not provided lists all permission levels)",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    user: User | null,
    interaction: CommandInteraction,
  ) {
    // If no user provided, list all permissions
    if (!user) {
      const permissions = [
        "🔴 **BOT_OWNER** (100) - Full bot access (configured via BOT_OWNER_ID environment variable)",
        "🟠 **STAFF** (80) - Staff-level administrative access (requires Staff role)",
        "🟡 **DEV_GUARD** (75) - Development and administrative access (requires Dev Guard role)",
        "🟢 **TRAINER** (60) - Training and mentoring access (requires Trainer role) - *Cannot access Host Attendance commands*",
        "🟢 **HOST_ATTENDANCE** (50) - Can manage attendance events (requires Host Attendance role) - *Cannot access Trainer commands*",
        "🔵 **SHIELD_MEMBER** (25) - Shield member access (requires Shield Member role)",
        "⚪ **USER** (0) - Basic user access (default)",
      ];

      await interaction.reply({
        content:
          `📋 **Role-Based Permission System**\n\n` +
          `Permissions are automatically assigned based on Discord roles:\n\n` +
          `${permissions.join("\n")}\n\n` +
          `💡 **Note:** To change a user's permissions, assign/remove the appropriate Discord roles using server settings.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get specific user's permission
    const targetUserId = user.id;

    try {
      // Get the target member
      const targetMember = interaction.guild?.members.cache.get(targetUserId);

      if (!targetMember) {
        await interaction.reply({
          content: "User not found in this server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Get the user's permission level based on their roles
      const permissionLevel =
        await getUserPermissionLevelFromRoles(targetMember);
      const levelValue = this.getPermissionLevelValue(permissionLevel);

      await interaction.reply({
        content: `👤 **${targetMember.displayName}**\nPermission Level: **${permissionLevel}** (${levelValue})`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error("Error getting user permission", error);
      await interaction.reply({
        content: "❌ Failed to get user permission. Please try again.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "list",
    description: "List all members with a specific role, or members with no roles if no role is selected",
  })
  @Guard(StaffGuard)
  async list(
    @SlashOption({
      name: "role",
      description: "Role to filter by (optional, if not provided lists members with no roles)",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    role: Role | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      if (!interaction.guild) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply();

      // Fetch all guild members
      const guild = interaction.guild;
      const allMembers = await guild.members.fetch();

      // Filter members based on role parameter
      let filteredMembers: Array<[string, import("discord.js").GuildMember]>;
      let title: string;

      if (role) {
        // Filter members with the specified role
        filteredMembers = Array.from(allMembers.filter((member) =>
          member.roles.cache.has(role.id),
        ));
        title = `Members with role: ${role.name}`;
      } else {
        // Filter members with no roles (only @everyone)
        filteredMembers = Array.from(
          allMembers.filter(
            (member) =>
              member.roles.cache.filter((r) => r.id !== member.guild.id).size ===
              0,
          ),
        );
        title = "Members with no roles";
      }

      if (filteredMembers.length === 0) {
        await interaction.editReply({
          content: `❌ No members found${
            role ? ` with role ${role.name}` : " with no roles"
          }.`,
        });
        return;
      }

      // Calculate optimal items per page
      // Format: **{index}.** <@{userId}> (${member.user.tag})
      // Approximate: ~50 chars per user (with index, mention, tag)
      // Target: ~80-90 users per page, leaving buffer for footer
      const maxDescriptionLength = 4000; // Leave buffer for embed overhead
      const avgUserLength = 50; // Approximate characters per user entry
      const itemsPerPage = Math.floor(maxDescriptionLength / avgUserLength);

      // Build pagination pages
      const totalPages = Math.ceil(filteredMembers.length / itemsPerPage);
      const pages: Array<{ embeds: EmbedBuilder[] }> = [];

      for (let i = 0; i < filteredMembers.length; i += itemsPerPage) {
        const chunk = filteredMembers.slice(i, i + itemsPerPage);
        const description = chunk
          .map(([, member], index) => {
            const listIndex = i + index + 1;
            return `**${listIndex}.** <@${member.id}> (${member.user.tag})`;
          })
          .join("\n");

        const embed = new EmbedBuilder()
          .setTitle(title)
          .setColor(0x0099ff)
          .setDescription(description)
          .setFooter({
            text: `Page ${Math.floor(i / itemsPerPage) + 1} of ${totalPages} • Total: ${filteredMembers.length} members`,
          })
          .setTimestamp();

        pages.push({ embeds: [embed] });
      }

      if (pages.length === 1) {
        await interaction.editReply(pages[0]);
        return;
      }

      const pagination = new Pagination(interaction, pages, {
        time: 120_000,
        onTimeout: async () => {
          try {
            await interaction.deleteReply();
          } catch (_error: unknown) {
            // ignore
          }
        },
      });

      await pagination.send();
    } catch (error: unknown) {
      loggers.bot.error("Error listing members", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: `❌ Failed to list members: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        });
      } else {
        await interaction.reply({
          content: `❌ Failed to list members: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  @Slash({
    name: "role",
    description: "Manage user roles (status, cancel, or assign roles)",
  })
  @Guard(StaffGuard)
  async role(
    @SlashChoice({ name: "Status", value: "status" })
    @SlashChoice({ name: "Cancel", value: "cancel" })
    @SlashChoice({ name: "In", value: "in" })
    @SlashOption({
      name: "action",
      description: "Action to perform",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    action: string,
    @SlashOption({
      name: "role",
      description: "Role to assign (required for 'in' action)",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    role: Role | null,
    @SlashOption({
      name: "user",
      description: "Target user (optional for 'in' action, ignored if unroled is true)",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    user: User | null,
    @SlashOption({
      name: "unroled",
      description: "Assign to all users without any roles (for 'in' action)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    unroled: boolean | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      if (!interaction.guild) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Handle status action
      if (action === "status") {
        // List all roles in the server
        const guild = interaction.guild;
        const allRoles = Array.from(
          guild.roles.cache
            .filter((r) => r.id !== guild.id)
            .values(),
        ).sort((a, b) => b.position - a.position);

        if (allRoles.length === 0) {
          await interaction.editReply({
            content: "❌ No roles found in this server.",
          });
          return;
        }

        const roleList = allRoles
          .map((r, index) => {
            const memberCount = r.members.size;
            return `**${index + 1}.** <@&${r.id}> (${r.name}) - ${memberCount} member${memberCount !== 1 ? "s" : ""}`;
          })
          .join("\n");

        const embed = new EmbedBuilder()
          .setTitle("Server Roles Status")
          .setDescription(roleList)
          .setColor(0x0099ff)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Handle cancel action
      if (action === "cancel") {
        await interaction.editReply({
          content: "✅ Operation cancelled.",
        });
        return;
      }

      // Handle "in" action (assign role)
      if (action === "in") {
        if (!role) {
          await interaction.editReply({
            content: "❌ Role is required for the 'in' action.",
          });
          return;
        }

        // Check if bot has permission to manage roles
        const botUser = interaction.client.user;
        if (!botUser) {
          await interaction.editReply({
            content: "❌ Unable to get bot user information.",
          });
          return;
        }
        const botMember = await interaction.guild.members.fetch(botUser.id);
        if (
          !botMember.permissions.has(PermissionFlagsBits.ManageRoles) ||
          !interaction.guild.members.me?.permissions.has(
            PermissionFlagsBits.ManageRoles,
          )
        ) {
          await interaction.editReply({
            content:
              "❌ I don't have permission to manage roles. Please contact a server administrator.",
          });
          return;
        }

        // Check if role is manageable
        const botHighestRole = botMember.roles.highest;
        if (botHighestRole.comparePositionTo(role) <= 0) {
          await interaction.editReply({
            content:
              "❌ I cannot manage this role because it is higher than or equal to my highest role.",
          });
          return;
        }

        let membersToAssign: GuildMember[] = [];

        // Check if unroled flag is set or a user was provided
        if (unroled === true) {
          // Get all members without any roles (only @everyone)
          const allMembers = await interaction.guild.members.fetch();
          membersToAssign = Array.from(
            allMembers.filter(
              (member) =>
                member.roles.cache.filter((r) => r.id !== member.guild.id)
                  .size === 0,
            ).values(),
          );
        } else if (user) {
          // Get the specific user
          const member = await interaction.guild.members.fetch(user.id);
          if (member.roles.cache.has(role.id)) {
            await interaction.editReply({
              content: `❌ <@${user.id}> already has the role <@&${role.id}>.`,
            });
            return;
          }
          membersToAssign = [member];
        } else {
          await interaction.editReply({
            content:
              "❌ You must either set 'unroled' to true or provide a user.",
          });
          return;
        }

        if (membersToAssign.length === 0) {
          await interaction.editReply({
            content: "❌ No members found to assign the role to.",
          });
          return;
        }

        // Assign role to all target members
        let successCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        for (const member of membersToAssign) {
          try {
            // Skip if already has the role
            if (member.roles.cache.has(role.id)) {
              continue;
            }

            await member.roles.add(
              role,
              `Role assigned via /user role command by ${interaction.user.tag}`,
            );
            successCount++;
          } catch (error: unknown) {
            failCount++;
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            errors.push(`<@${member.id}>: ${errorMsg}`);
            loggers.bot.error(`Error assigning role to ${member.id}`, error);
          }
        }

        let resultMessage = `✅ Assigned role <@&${role.id}> to ${successCount} member${successCount !== 1 ? "s" : ""}.`;
        if (failCount > 0) {
          resultMessage += `\n❌ Failed to assign to ${failCount} member${failCount !== 1 ? "s" : ""}.`;
          if (errors.length > 0 && errors.length <= 5) {
            resultMessage += "\n" + errors.join("\n");
          }
        }

        await interaction.editReply({
          content: resultMessage,
        });
        return;
      }

      await interaction.editReply({
        content: "❌ Invalid action specified.",
      });
    } catch (error: unknown) {
      loggers.bot.error("Error in role command", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: `❌ An error occurred: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        });
      } else {
        await interaction.reply({
          content: `❌ An error occurred: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  // Helper method to get numeric value (duplicate from permissionUtils for simplicity)
  private getPermissionLevelValue(level: PermissionLevel): number {
    switch (level) {
      case PermissionLevel.BOT_OWNER:
        return 100;
      case PermissionLevel.DEV_GUARD:
        return 99;
      case PermissionLevel.STAFF:
        return 75;
      case PermissionLevel.TRAINER:
        return 60;
      case PermissionLevel.HOST_ATTENDANCE:
        return 50;
      case PermissionLevel.SHIELD_MEMBER:
        return 25;
      case PermissionLevel.USER:
        return 0;
      default:
        return 0;
    }
  }
}
