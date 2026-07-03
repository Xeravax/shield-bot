import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  escapeMarkdown,
  Role,
  User,
  MessageFlags,
} from "discord.js";
import { Pagination } from "@discordx/pagination";
import { Discord, Slash, SlashGroup, SlashOption, Guard, SlashChoice } from "discordx";
import { whitelistManager } from "../../managers/whitelist/whitelistManager.js";
import { searchUsers } from "../../utility/vrchat/user.js";
import { PermissionNodeGuard } from "../../utility/permissionNodes.js";
import { loggers } from "../../utility/logger.js";

@Discord()
@SlashGroup({
  name: "whitelist",
  description: "VRChat whitelist management commands",
})
@SlashGroup("whitelist")
export class WhitelistCommands {
  @Slash({ description: "Manage Discord role mappings to whitelist permissions" })
  @Guard(PermissionNodeGuard("whitelist.command.role"))
  async role(
    @SlashChoice({ name: "Setup", value: "setup" })
    @SlashChoice({ name: "Remove", value: "remove" })
    @SlashChoice({ name: "List", value: "list" })
    @SlashOption({
      description: "Action to perform",
      name: "action",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    action: string,
    @SlashOption({
      description: "Discord role to map (required for setup/remove)",
      name: "discord_role",
      required: false,
      type: ApplicationCommandOptionType.Role,
    })
    discordRole: Role | null,
    @SlashOption({
      description:
        "Permissions (comma-separated): station, truavatar, trudoor, forceAvatar, forceDoor",
      name: "permissions",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    permissions: string | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const guildId = interaction.guildId;

      // Handle list action
      if (action === "list") {
        const roleMappings = await whitelistManager.getDiscordRoleMappings(guildId);

        if (roleMappings.length === 0) {
          await interaction.reply({
            content: "❌ No Discord role mappings found.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle("📋 Discord Role Mappings")
          .setColor(0x0099ff);

        const roleList = roleMappings
          .map((role) => {
            const roleTyped = role as { id: number; discordRoleId: string | null; permissions: string | null; guildId: string };
            const discordRole = roleTyped.discordRoleId
              ? `<@&${roleTyped.discordRoleId}>`
              : "Not linked";
            const permissions = roleTyped.permissions || "No permissions";
            return `**Role ID: ${roleTyped.id}**\nDiscord: ${discordRole}\nPermissions: ${permissions}\nGuild: ${roleTyped.guildId}`;
          })
          .join("\n\n");

        embed.setDescription(roleList);
        await interaction.reply({ embeds: [embed] });
        return;
      }

      // Handle remove action
      if (action === "remove") {
        if (!discordRole) {
          await interaction.reply({
            content: "❌ Discord role is required for remove action.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        if (!interaction.guild) {
          await interaction.reply({
            content: "❌ This command can only be used in a server.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const success = await whitelistManager.deleteRole(interaction.guild.id, discordRole.id);

        if (success) {
          const embed = new EmbedBuilder()
            .setTitle("✅ Role Mapping Removed")
            .setColor(0xff0000)
            .addFields({ name: "Discord Role", value: `<@&${discordRole.id}>` })
            .setTimestamp();

          await interaction.reply({ embeds: [embed] });

          // Trigger a resync for all members who had this role
          const guild = interaction.guild;
          if (guild) {
            const allMembers = await guild.members.fetch();
            const membersWithRole = allMembers.filter((member) =>
              member.roles.cache.has(discordRole.id),
            );

            loggers.bot.info(
              `Revalidating access for ${membersWithRole.size} members after removing role mapping for ${discordRole.name}`,
            );

            let accessUpdated = 0;
            let errors = 0;

            for (const [, member] of membersWithRole) {
              try {
                const roleIds = member.roles.cache.map((role) => role.id);

                // Get their current whitelist status
                const userBefore = await whitelistManager.getUserByDiscordId(
                  member.id,
                  guildId,
                );
                const hadAccessBefore = !!(userBefore as { whitelistEntries?: unknown[] })?.whitelistEntries && (userBefore as { whitelistEntries: unknown[] }).whitelistEntries.length > 0;

                // Sync their roles (this will remove access if they no longer qualify)
                await whitelistManager.syncUserRolesFromDiscord(
                  member.id,
                  roleIds,
                  guildId,
                );

                // Check their status after sync
                const userAfter = await whitelistManager.getUserByDiscordId(
                  member.id,
                  guildId,
                );
                const hasAccessAfter = !!(userAfter as { whitelistEntries?: unknown[] })?.whitelistEntries && (userAfter as { whitelistEntries: unknown[] }).whitelistEntries.length > 0;

                if (hadAccessBefore !== hasAccessAfter) {
                  accessUpdated++;
                }
              } catch (error) {
                loggers.bot.error(
                  `Error revalidating access for ${member.displayName}`,
                  error,
                );
                errors++;
              }
            }

            loggers.bot.info(
              `Role removal revalidation complete: ${accessUpdated} access changed, ${errors} errors`,
            );
            
            // Queue a single batched update after processing all members
            if (accessUpdated > 0) {
              const msg = `Role mapping removed for ${discordRole.name}`;
              whitelistManager.queueBatchedUpdate('bulk-role-removal', msg);
            }
          }
        } else {
          await interaction.reply({
            content: `❌ Role mapping not found.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      // Handle setup action
      if (action !== "setup") {
        await interaction.reply({
          content: "❌ Invalid action. Use 'setup', 'remove', or 'list'.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!discordRole) {
        await interaction.reply({
          content: "❌ Discord role is required for setup action.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!permissions) {
        await interaction.reply({
          content: "❌ Permissions are required for setup action.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const permissionList = permissions
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p);

      if (permissionList.length === 0) {
        await interaction.reply({
          content: "❌ You must provide at least one permission.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Check for permissions with non-unicode characters
      const invalidPermissions = permissionList.filter((p) => {
        // Check if the permission contains only unicode characters
        try {
          // This will throw if there are invalid unicode sequences
          const encoded = Buffer.from(p, "utf8").toString("utf8");
          return encoded !== p;
        } catch {
          return true; // Invalid if encoding fails
        }
      });

      if (invalidPermissions.length > 0) {
        await interaction.reply({
          content: `❌ Invalid permissions (contain non-unicode characters): ${invalidPermissions.join(", ")}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await whitelistManager.setupDiscordRoleMapping(
        discordRole.id,
        interaction.guildId,
        permissionList,
      );

      const embed = new EmbedBuilder()
        .setTitle("✅ Discord Role Mapping Created")
        .setColor(0x00ff00)
        .addFields(
          {
            name: "Discord Role",
            value: `<@&${discordRole.id}>`,
            inline: true,
          },
          {
            name: "Permissions",
            value: permissionList.join(", "),
            inline: true,
          },
        )
        .setFooter({
          text: "Users with this role will automatically get these whitelist permissions",
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // Trigger a resync for all members with this role
      const guild = interaction.guild;
      if (guild) {
        const allMembers = await guild.members.fetch();
        const membersWithRole = allMembers.filter((member) =>
          member.roles.cache.has(discordRole.id),
        );

        loggers.bot.info(
          `Triggering resync for ${membersWithRole.size} members with role ${discordRole.name}`,
        );

        for (const [, member] of membersWithRole) {
          try {
            const roleIds = member.roles.cache.map((role) => role.id);
            if (await whitelistManager.shouldUserBeWhitelisted(roleIds)) {
              if (!interaction.guildId) {
                continue;
              }
              await whitelistManager.syncUserRolesFromDiscord(
                member.id,
                roleIds,
                interaction.guildId,
              );
            }
          } catch (error) {
            loggers.bot.error(
              `Error resyncing ${member.displayName}`,
              error,
            );
          }
        }
        
        // Queue a single batched update after processing all members
        if (membersWithRole.size > 0) {
          const msg = `Role mapping updated for ${discordRole.name}: ${permissionList.join(", ")}`;
          whitelistManager.queueBatchedUpdate('bulk-role-setup', msg);
        }
      }
    } catch (error: unknown) {
      await interaction.reply({
        content: `❌ Failed to setup role mapping: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }


  @Slash({ description: "Manage whitelist user operations" })
  @Guard(PermissionNodeGuard("whitelist.command.user"))
  async user(
    @SlashChoice({ name: "Info", value: "info" })
    @SlashChoice({ name: "Sync", value: "sync" })
    @SlashChoice({ name: "Browse", value: "browse" })
    @SlashOption({
      description: "Action to perform",
      name: "action",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    action: string,
    @SlashOption({
      description: "Discord user (required for info/sync)",
      name: "discord_user",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    user: User | null,
    @SlashOption({
      description: "VRChat username to check (optional for info)",
      name: "vrchat_username",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    vrchatUsername: string | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const guildId = interaction.guildId;

    // Handle browse action
    if (action === "browse") {
      try {
        await interaction.deferReply();

        const whitelistEntries = await whitelistManager.getWhitelistUsers(guildId);

        if (whitelistEntries.length === 0) {
          await interaction.editReply({
            content: "❌ No users found in the whitelist.",
          });
          return;
        }

        const pageSize = 10;
        const totalPages = Math.ceil(whitelistEntries.length / pageSize);
        const pages: Array<{ embeds: EmbedBuilder[] }> = [];

        for (let i = 0; i < whitelistEntries.length; i += pageSize) {
          const chunk = whitelistEntries.slice(i, i + pageSize);
          const description = chunk
            .map((entry, index: number) => {
              const entryTyped = entry as {
                discordId?: string;
                vrchatUsername?: string;
                vrcUserId?: string;
                roles?: string[];
              };
              const listIndex = i + index + 1;
              const mention = entryTyped.discordId
                ? `<@${entryTyped.discordId}>`
                : "Unknown Discord user";
              const vrchatDisplay = entryTyped.vrchatUsername || "Unknown VRChat user";
              const vrcLink = entryTyped.vrcUserId
                ? `https://vrchat.com/home/user/${encodeURIComponent(entryTyped.vrcUserId)}`
                : null;
              const vrchatLine = vrcLink
                ? `[${vrchatDisplay}](${vrcLink})`
                : vrchatDisplay;
              const whitelistRoles: string = entryTyped.roles?.length
                ? entryTyped.roles
                    .map((role: string) => `\`${escapeMarkdown(role)}\``)
                    .join(", ")
                : "No whitelist permissions";

              return `**${listIndex}.** ${mention}\n• VRChat: ${vrchatLine}\n• Whitelist: ${whitelistRoles}`;
            })
            .join("\n\n");

          const embed = new EmbedBuilder()
            .setTitle("📋 Whitelist Users")
            .setColor(0x0099ff)
            .setDescription(description)
            .setFooter({
              text: `Page ${Math.floor(i / pageSize) + 1} of ${totalPages} • Total: ${whitelistEntries.length} users`,
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
        });

        await pagination.send();
      } catch (error: unknown) {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: `❌ Failed to list users: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
        } else {
          await interaction.reply({
            content: `❌ Failed to list users: ${error instanceof Error ? error.message : "Unknown error"}`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }
      return;
    }

    // Handle sync action
    if (action === "sync") {
      if (!user) {
        await interaction.reply({
          content: "❌ Discord user is required for sync action.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      try {
        const member = await interaction.guild?.members.fetch(user.id);
        if (!member) {
          await interaction.reply({
            content: "❌ User not found in this server.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const roleIds = member.roles.cache.map((role) => role.id);
        const shouldBeWhitelisted =
          await whitelistManager.shouldUserBeWhitelisted(roleIds, guildId);

        if (shouldBeWhitelisted) {
          await whitelistManager.syncUserRolesFromDiscord(
            user.id,
            roleIds,
            guildId,
          );

          const userInfo = await whitelistManager.getUserByDiscordId(user.id, guildId);
          const userTyped = userInfo as {
            whitelistEntries?: Array<{
              roleAssignments: Array<{ role: { permissions: string | null } }>;
            }>;
          } | null;
          
          // Extract permissions from role assignments properly
          const allPermissions = new Set<string>();
          const whitelistEntry = userTyped?.whitelistEntries?.[0];
          for (const assignment of whitelistEntry?.roleAssignments || []) {
            if (assignment.role.permissions) {
              // Split comma-separated permissions and add to set
              const rolePermissions = assignment.role.permissions
                .split(',')
                .map((p: string) => p.trim())
                .filter(Boolean);
              rolePermissions.forEach((perm: string) => allPermissions.add(perm));
            }
          }
          
          const permissions = allPermissions.size > 0 
            ? Array.from(allPermissions).sort().join(", ")
            : "None";

          const embed = new EmbedBuilder()
            .setTitle("✅ User Synced")
            .setColor(0x00ff00)
            .addFields(
              { name: "User", value: `<@${user.id}>`, inline: true },
              { name: "Permissions", value: permissions, inline: true },
            )
            .setTimestamp();

          await interaction.reply({ embeds: [embed] });
        } else {
          await whitelistManager.removeUserFromWhitelistIfNoRoles(user.id, guildId);
          await interaction.reply({
            content: `❌ User <@${user.id}> has no Discord roles that map to whitelist permissions.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (error: unknown) {
        await interaction.reply({
          content: `❌ Failed to sync user: ${error instanceof Error ? error.message : "Unknown error"}`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    // Handle info action
    if (action !== "info") {
      await interaction.reply({
        content: "❌ Invalid action. Use 'info', 'sync', or 'browse'.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetUser = user || interaction.user;

    try {
      let userInfo: {
        id?: number;
        discordId?: string;
        vrchatAccounts?: Array<{ vrchatUsername?: string | null }>;
        whitelistEntries?: Array<{
          roleAssignments: Array<{
            role: { permissions: string | null };
            expiresAt: Date | null;
          }>;
        }>;
      } | null = null;

      if (targetUser && targetUser.id !== interaction.user.id) {
        // If a specific user is provided, get detailed info
        const detailedUser = await whitelistManager.getUserByDiscordId(targetUser.id, guildId);

        if (!detailedUser || !(detailedUser as { whitelistEntries?: unknown[] }).whitelistEntries || (detailedUser as { whitelistEntries: unknown[] }).whitelistEntries.length === 0) {
          await interaction.reply({
            content: `❌ User not found in whitelist for this guild.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const whitelistEntry = (detailedUser as { whitelistEntries: Array<{ roleAssignments: Array<{ role: { permissions: string | null }; expiresAt: Date | null }>; createdAt: Date }> }).whitelistEntries[0];

        // Extract permissions properly with expiry info
        const activeRoles: string[] = [];
        for (const assignment of whitelistEntry?.roleAssignments || []) {
          if (!assignment.expiresAt || assignment.expiresAt > new Date()) {
            if (assignment.role.permissions) {
              const rolePermissions = assignment.role.permissions
                .split(',')
                .map((p: string) => p.trim())
                .filter(Boolean);
              
              const expiry = assignment.expiresAt
                ? ` (expires ${assignment.expiresAt.toDateString()})`
                : "";
              
              rolePermissions.forEach((perm: string) => {
                activeRoles.push(`${perm}${expiry}`);
              });
            }
          }
        }

        const vrchatAccounts =
          detailedUser.vrchatAccounts
            ?.map(
              (account: { vrcUserId: string; accountType: string }) => `${account.vrcUserId} (${account.accountType})`,
            )
            ?.join("\n") || "No verified VRChat accounts";

        const embed = new EmbedBuilder()
          .setTitle("👤 User Information")
          .setColor(0x0099ff)
          .addFields(
            { name: "Discord User", value: `<@${detailedUser.discordId}>`, inline: true },
            { name: "VRChat Accounts", value: vrchatAccounts, inline: true },
            {
              name: "Added to Whitelist",
              value: whitelistEntry?.createdAt?.toDateString() || "Unknown",
              inline: true,
            },
            {
              name: "Active Roles",
              value:
                activeRoles.length > 0
                  ? activeRoles.join("\n")
                  : "No roles assigned",
            },
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        return;
      }

      // Default info behavior (basic info)
      if (targetUser) {
        userInfo = await whitelistManager.getUserByDiscordId(targetUser.id, guildId);
      } else if (vrchatUsername) {
        const searchResults = await searchUsers({
          search: vrchatUsername.trim(),
          n: 1,
        });
        if (searchResults.length > 0) {
          userInfo = await whitelistManager.getUserByVrcUserId(
            searchResults[0].id,
            guildId,
          );
        }
      }

      if (!userInfo) {
        await interaction.reply({
          content: "❌ User not found in the system.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("📋 User Whitelist Info")
        .setColor(0x0099ff);

      if (userInfo.discordId) {
        embed.addFields({
          name: "Discord User",
          value: `<@${userInfo.discordId}>`,
          inline: true,
        });
      }

      if (userInfo.vrchatAccounts && userInfo.vrchatAccounts.length > 0 && userInfo.vrchatAccounts[0]?.vrchatUsername) {
        embed.addFields({
          name: "VRChat Username",
          value: userInfo.vrchatAccounts[0].vrchatUsername,
          inline: true,
        });
      }

      const whitelistEntries = (userInfo as { whitelistEntries?: Array<{ roleAssignments: Array<{ role: { permissions: string | null }; expiresAt: Date | null }> }> }).whitelistEntries;
      if (whitelistEntries && whitelistEntries.length > 0) {
        const whitelistEntry = whitelistEntries[0];
        // Extract permissions from role assignments properly
        const allActivePermissions = new Set<string>();
        const allExpiredPermissions = new Set<string>();
        
        for (const assignment of whitelistEntry.roleAssignments) {
          if (assignment.role.permissions) {
            const rolePermissions = assignment.role.permissions
              .split(',')
              .map((p: string) => p.trim())
              .filter(Boolean);
            
            const isExpired = assignment.expiresAt && assignment.expiresAt <= new Date();
            if (isExpired) {
              rolePermissions.forEach((perm: string) => allExpiredPermissions.add(perm));
            } else {
              rolePermissions.forEach((perm: string) => allActivePermissions.add(perm));
            }
          }
        }
        
        const permissions = allActivePermissions.size > 0 
          ? Array.from(allActivePermissions).sort().join(", ")
          : "None";

        embed.addFields(
          { name: "Whitelist Status", value: "✅ Whitelisted", inline: true },
          { name: "Active Permissions", value: permissions, inline: true },
        );

        if (allExpiredPermissions.size > 0) {
          const expiredPermissions = Array.from(allExpiredPermissions).sort().join(", ");
          embed.addFields({
            name: "Expired Permissions",
            value: expiredPermissions,
            inline: true,
          });
        }
      } else {
        embed.addFields({
          name: "Whitelist Status",
          value: "❌ Not whitelisted",
          inline: true,
        });
      }

      await interaction.reply({ embeds: [embed] });
    } catch (error: unknown) {
      await interaction.reply({
        content: `❌ Failed to get user info: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }


  @Slash({ description: "Get whitelist statistics" })
  @Guard(PermissionNodeGuard("whitelist.command.stats"))
  async stats(interaction: CommandInteraction): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const stats = await whitelistManager.getStatistics(interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle("📊 Whitelist Statistics")
        .setColor(0x0099ff)
        .addFields(
          {
            name: "Total Users",
            value: stats.totalUsers.toString(),
            inline: true,
          },
          {
            name: "Total Roles",
            value: stats.totalRoles.toString(),
            inline: true,
          },
          {
            name: "Active Assignments",
            value: stats.totalActiveAssignments.toString(),
            inline: true,
          },
          {
            name: "Expired Assignments",
            value: stats.totalExpiredAssignments.toString(),
            inline: true,
          },
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error: unknown) {
      await interaction.reply({
        content: `❌ Failed to get statistics: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({ description: "Generate and download the encoded whitelist" })
  @Guard(PermissionNodeGuard("whitelist.command.generate"))
  async generate(interaction: CommandInteraction): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply();

      const [rawContent, encodedContent] = await Promise.all([
        whitelistManager.generateWhitelistContent(interaction.guildId),
        whitelistManager.generateEncodedWhitelist(interaction.guildId),
      ]);

      const stats = await whitelistManager.getStatistics(interaction.guildId);

      // Try to update the GitHub repository with the new whitelist
      let repoUpdateSuccess = false;
      let repoUpdateError = null;
      try {
        await whitelistManager.publishWhitelist(
          interaction.guildId,
          `manual generate: latest whitelist`,
          true // Force update even if content unchanged
        );
        repoUpdateSuccess = true;
      } catch (repoError: unknown) {
        repoUpdateError = repoError instanceof Error ? repoError.message : "Unknown error";
        loggers.bot.warn("Failed to update GitHub repository", repoError);
      }

      const embed = new EmbedBuilder()
        .setTitle("✅ Whitelist Generated")
        .setColor(0x00ff00)
        .addFields(
          {
            name: "Total Users",
            value: stats.totalUsers.toString(),
            inline: true,
          },
          {
            name: "Active Assignments",
            value: stats.totalActiveAssignments.toString(),
            inline: true,
          },
          {
            name: "Raw Content Size",
            value: `${rawContent.length} characters`,
            inline: true,
          },
          {
            name: "Encoded Size",
            value: `${encodedContent.length} characters`,
            inline: true,
          },
          {
            name: "GitHub Repository",
            value: repoUpdateSuccess
              ? "✅ Updated"
              : `❌ Failed: ${repoUpdateError}`,
            inline: true,
          },
          {
            name: "Cloudflare Cache",
            value: "✅ Purged",
            inline: true,
          },
        )
        .setDescription(
          "```\n" +
            rawContent.substring(0, 1000) +
            (rawContent.length > 1000 ? "...\n```" : "\n```"),
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error: unknown) {
      await interaction.editReply({
        content: `❌ Failed to generate whitelist: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({
    description: "Validate and cleanup whitelist access for all server members",
  })
  @Guard(PermissionNodeGuard("whitelist.command.validate"))
  async validate(
    @SlashOption({
      description: "Specific Discord user to validate (optional)",
      name: "user",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    user: User | null,
    @SlashOption({
      description: "VRChat username to validate (optional)",
      name: "vrchat_username",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    vrchatUsername: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      await interaction.deferReply();

      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply({
          content: "❌ This command can only be used in a server.",
        });
        return;
      }

      // Handle VRChat username lookup
      if (vrchatUsername && !user) {
        const searchResults = await searchUsers({
          search: vrchatUsername.trim(),
          n: 1,
        });

        if (searchResults.length === 0) {
          await interaction.editReply({
            content: `❌ No VRChat user found with username: ${vrchatUsername}`,
          });
          return;
        }

        const vrcUser = searchResults[0] as { id: string; displayName?: string };
        const userInfo = await whitelistManager.getUserByVrcUserId(vrcUser.id, guild.id);
        const userInfoTyped = userInfo as { discordId?: string } | null;

        if (!userInfoTyped) {
          await interaction.editReply({
            content: `❌ VRChat user **${vrcUser.displayName || vrcUser.id}** is not in the database.`,
          });
          return;
        }

        // Look up the Discord user from the database
        const discordUserId = userInfoTyped.discordId;
        if (!discordUserId) {
          await interaction.editReply({
            content: `❌ VRChat user **${vrcUser.displayName || vrcUser.id}** has no Discord account linked.`,
          });
          return;
        }
        const member = await guild.members.fetch(discordUserId).catch(() => null);

        if (!member) {
          await interaction.editReply({
            content: `❌ VRChat user **${vrcUser.displayName || vrcUser.id}** (Discord: <@${discordUserId}>) is not in this server.`,
          });
          return;
        }

        // Validate this specific user
        const roleIds = member.roles.cache.map((role) => role.id);
        const userBefore = await whitelistManager.getUserByDiscordId(discordUserId, guild.id);
        const hadAccessBefore = !!(userBefore as { whitelistEntries?: unknown[] })?.whitelistEntries && (userBefore as { whitelistEntries: unknown[] }).whitelistEntries.length > 0;

        await whitelistManager.syncUserRolesFromDiscord(
          discordUserId,
          roleIds,
          guild.id,
        );

        const userAfter = await whitelistManager.getUserByDiscordId(discordUserId, guild.id);
        const userAfterTyped = userAfter as {
          whitelistEntries?: Array<{
            roleAssignments: Array<{ role: { discordRoleId?: string | null; id: number } }>;
          }>;
        } | null;
        const whitelistEntry = userAfterTyped?.whitelistEntries?.[0];
        const hasAccessAfter = !!whitelistEntry;
        const rolesAfter =
          whitelistEntry?.roleAssignments?.map((a) => a.role.discordRoleId || String(a.role.id)) ||
          [];

        const embed = new EmbedBuilder()
          .setTitle("✅ User Access Validation Complete")
          .setColor(hasAccessAfter ? 0x00ff00 : 0xff0000)
          .addFields(
            { name: "VRChat Username", value: vrcUser.displayName || vrcUser.id, inline: true },
            { name: "Discord User", value: `<@${discordUserId}>`, inline: true },
            {
              name: "Has Access",
              value: hasAccessAfter ? "✅ Yes" : "❌ No",
              inline: true,
            },
            {
              name: "Changes Made",
              value: hadAccessBefore !== hasAccessAfter ? "✅ Yes" : "❌ No",
              inline: true,
            },
          )
          .setTimestamp();

        if (hasAccessAfter) {
          embed.addFields({
            name: "Current Roles",
            value: rolesAfter.join(", ") || "None",
            inline: false,
          });
        }

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (user) {
        // Validate specific user
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) {
          await interaction.editReply({
            content: "❌ User not found in this server.",
          });
          return;
        }

        const roleIds = member.roles.cache.map((role) => role.id);

        // Get their current whitelist status
        const userBefore = await whitelistManager.getUserByDiscordId(user.id, guild.id);
        const hadAccessBefore = !!(userBefore as { whitelistEntries?: unknown[] })?.whitelistEntries && (userBefore as { whitelistEntries: unknown[] }).whitelistEntries.length > 0;

        // Sync their roles (this will add/remove access as needed)
        await whitelistManager.syncUserRolesFromDiscord(
          user.id,
          roleIds,
          guild.id,
        );

        // Check their status after sync
        const userAfter = await whitelistManager.getUserByDiscordId(user.id, guild.id);
        const userAfterTyped = userAfter as {
          whitelistEntries?: Array<{
            roleAssignments: Array<{ role: { discordRoleId: string | null; id: number } }>;
          }>;
        } | null;
        const hasAccessAfter = !!(userAfterTyped?.whitelistEntries && userAfterTyped.whitelistEntries.length > 0);
        const whitelistEntry = userAfterTyped?.whitelistEntries?.[0];
        const rolesAfter =
          whitelistEntry?.roleAssignments?.map((a: { role: { discordRoleId: string | null; id: number } }) => a.role.discordRoleId || String(a.role.id)) ||
          [];

        const embed = new EmbedBuilder()
          .setTitle("✅ User Access Validation Complete")
          .setColor(hasAccessAfter ? 0x00ff00 : 0xff0000)
          .addFields(
            { name: "User", value: `<@${user.id}>`, inline: true },
            {
              name: "Has Access",
              value: hasAccessAfter ? "✅ Yes" : "❌ No",
              inline: true,
            },
            {
              name: "Changes Made",
              value: hadAccessBefore !== hasAccessAfter ? "✅ Yes" : "❌ No",
              inline: true,
            },
          )
          .setTimestamp();

        if (hasAccessAfter) {
          embed.addFields({
            name: "Current Roles",
            value: rolesAfter.join(", ") || "None",
            inline: false,
          });
        }

        await interaction.editReply({ embeds: [embed] });
      } else {
        // Validate all members
        const members = await guild.members.fetch();
        let validated = 0;
        let accessGranted = 0;
        let accessRevoked = 0;
        let errors = 0;

        // Step 1: Validate all current guild members
        for (const [, member] of members) {
          try {
            const roleIds = member.roles.cache.map((role) => role.id);

            // Get their current whitelist status
            const userBefore = await whitelistManager.getUserByDiscordId(
              member.id,
              guild.id,
            );
            const hadAccessBefore = !!(userBefore as { whitelistEntries?: unknown[] })?.whitelistEntries && (userBefore as { whitelistEntries: unknown[] }).whitelistEntries.length > 0;

            // Sync their roles
            await whitelistManager.syncUserRolesFromDiscord(
              member.id,
              roleIds,
              guild.id,
            );

            // Check their status after sync
            const userAfter = await whitelistManager.getUserByDiscordId(
              member.id,
              guild.id,
            );
            const hasAccessAfter = !!(userAfter as { whitelistEntries?: unknown[] })?.whitelistEntries && (userAfter as { whitelistEntries: unknown[] }).whitelistEntries.length > 0;

            validated++;

            if (hadAccessBefore !== hasAccessAfter) {
              if (hasAccessAfter) {
                accessGranted++;
              } else {
                accessRevoked++;
              }
            }
          } catch (error) {
            loggers.bot.error(
              `Error validating access for ${member.displayName}`,
              error,
            );
            errors++;
          }
        }

        // Step 2: Check all whitelisted users and remove those not in the guild
        const whitelistedUsers = await whitelistManager.getWhitelistUsers(guild.id);
        let usersNotInGuild = 0;

        for (const whitelistEntry of whitelistedUsers) {
          try {
            const entry = whitelistEntry as { discordId?: string; vrchatUsername?: string };
            if (!entry.discordId) {continue;}

            // Check if user is in the current guild members
            const isInGuild = members.has(entry.discordId);

            if (!isInGuild) {
              // User has whitelist access but is not in the guild - remove them
              await whitelistManager.removeUserFromWhitelistIfNoRoles(
                entry.discordId,
                guild.id,
              );
              usersNotInGuild++;
              accessRevoked++;
              loggers.bot.info(
                `Removed ${entry.vrchatUsername || entry.discordId} - no longer in guild`,
              );
            }
          } catch (error) {
            const entry = whitelistEntry as { discordId?: string; vrchatUsername?: string };
            loggers.bot.error(
              `Error checking guild membership for ${entry.vrchatUsername || entry.discordId}`,
              error,
            );
            errors++;
          }
        }

        const embed = new EmbedBuilder()
          .setTitle("✅ Bulk Access Validation Complete")
          .setColor(0x00ff00)
          .addFields(
            {
              name: "Guild Members Validated",
              value: validated.toString(),
              inline: true,
            },
            {
              name: "Users Not in Guild (Removed)",
              value: usersNotInGuild.toString(),
              inline: true,
            },
            {
              name: "Access Granted",
              value: accessGranted.toString(),
              inline: true,
            },
            {
              name: "Access Revoked",
              value: accessRevoked.toString(),
              inline: true,
            },
            { name: "Errors", value: errors.toString(), inline: true },
          )
          .setDescription(
            `Validated ${validated} guild members and checked ${whitelistedUsers.length} whitelisted users for guild membership.`,
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Cleanup expired roles as part of validation
        const cleanedCount = await whitelistManager.cleanupExpiredRoles();
        if (cleanedCount > 0) {
          loggers.bot.info(`Cleaned up ${cleanedCount} expired role assignments during validation`);
        }

        // Update GitHub repository if any changes were made
        if (accessGranted > 0 || accessRevoked > 0 || cleanedCount > 0) {
          try {
            const msg = `Bulk validation: ${accessGranted} granted, ${accessRevoked} revoked, ${cleanedCount} expired cleaned`;
            whitelistManager.queueBatchedUpdate('bulk-validation', msg);
            loggers.bot.info(
              `Queued GitHub repository update after bulk validation`,
            );
          } catch (gistError) {
            loggers.bot.warn(
              `Failed to queue GitHub repository update after bulk validation`,
              gistError,
            );
          }
        }
      }
    } catch (error: unknown) {
      await interaction.editReply({
        content: `❌ Failed to validate access: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }
}
