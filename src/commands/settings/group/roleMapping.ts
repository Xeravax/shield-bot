import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  EmbedBuilder,
  Colors,
  Role,
  MessageFlags,
} from "discord.js";
import { StaffGuard } from "../../../utility/guards.js";
import { patrolTimer, prisma } from "../../../main.js";
import { getGroupRoles } from "../../../utility/vrchat/groups.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
@SlashGroup({ name: "group", description: "VRChat group management" })
@SlashGroup({
  name: "role",
  description: "VRChat group role mapping",
  root: "group",
})
@SlashGroup("role", "group")
@Guard(StaffGuard)
export class GroupRoleMappingCommand {
  @Slash({
    name: "map",
    description: "Map a Discord role to a VRChat group role",
  })
  async mapRole(
    @SlashOption({
      name: "discord_role",
      description: "Discord role to map from",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    discordRole: Role,
    @SlashOption({
      name: "vrc_role_id",
      description: "VRChat group role ID to assign (e.g., grol_xxx)",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    vrcRoleId: string,
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

      // Get guild settings to find VRChat group ID
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      if (!settings?.vrcGroupId) {
        await interaction.reply({
          content:
            "❌ No VRChat group ID configured. Please set it first using `/settings group set-group-id`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Validate VRChat role ID format
      if (!vrcRoleId.startsWith("grol_")) {
        await interaction.reply({
          content:
            "❌ Invalid VRChat role ID format. It should start with 'grol_'.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Create or update the mapping
      await prisma.groupRoleMapping.upsert({
        where: {
          guildId_discordRoleId_vrcGroupRoleId: {
            guildId: interaction.guildId,
            discordRoleId: discordRole.id,
            vrcGroupRoleId: vrcRoleId,
          },
        },
        update: {
          // Nothing to update since all fields are in the unique key
        },
        create: {
          guildId: interaction.guildId,
          vrcGroupId: settings.vrcGroupId,
          vrcGroupRoleId: vrcRoleId,
          discordRoleId: discordRole.id,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-group-role-mapping",
        interaction.user.id,
        undefined,
        `map ${discordRole.name} -> ${vrcRoleId}`,
      );

      const embed = new EmbedBuilder()
        .setTitle("✅ Role Mapping Created")
        .setDescription(
          `Discord role <@&${discordRole.id}> is now mapped to VRChat role \`${vrcRoleId}\`.`,
        )
        .addFields({
          name: "ℹ️ How it works",
          value:
            "Members with this Discord role will automatically be assigned the VRChat group role when they join the group or when their Discord roles are updated.",
        })
        .setColor(Colors.Green)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Role Sync" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error: unknown) {
      loggers.bot.error("Error mapping role", error);
      await interaction.reply({
        content: `❌ Failed to map role: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "unmap",
    description: "Remove a Discord role to VRChat group role mapping",
  })
  async unmapRole(
    @SlashOption({
      name: "discord_role",
      description: "Discord role to unmap",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    discordRole: Role,
    @SlashOption({
      name: "vrc_role_id",
      description: "VRChat group role ID to unmap (e.g., grol_xxx)",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    vrcRoleId: string,
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

      const mapping = await prisma.groupRoleMapping.findFirst({
        where: {
          guildId: interaction.guildId,
          discordRoleId: discordRole.id,
          vrcGroupRoleId: vrcRoleId,
        },
      });

      if (!mapping) {
        await interaction.reply({
          content: `❌ No mapping found for Discord role <@&${discordRole.id}> to VRChat role \`${vrcRoleId}\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.groupRoleMapping.delete({
        where: {
          id: mapping.id,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-group-role-mapping",
        interaction.user.id,
        undefined,
        `unmap ${discordRole.name} -> ${vrcRoleId}`,
      );

      const embed = new EmbedBuilder()
        .setTitle("✅ Role Mapping Removed")
        .setDescription(
          `The mapping from Discord role <@&${discordRole.id}> to VRChat role \`${vrcRoleId}\` has been removed.`,
        )
        .setColor(Colors.Green)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Role Sync" })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error: unknown) {
      loggers.bot.error("Error unmapping role", error);
      await interaction.reply({
        content: `❌ Failed to unmap role: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "list",
    description: "List all Discord to VRChat group role mappings for this server",
  })
  async listMappings(interaction: CommandInteraction): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const mappings = await prisma.groupRoleMapping.findMany({
        where: { guildId: interaction.guildId },
      });

      if (mappings.length === 0) {
        await interaction.reply({
          content:
            "ℹ️ No role mappings configured. Use `/group role map` to create mappings.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Group mappings by VRChat role ID
      const groupedMappings = new Map<string, string[]>();
      for (const mapping of mappings) {
        if (!groupedMappings.has(mapping.vrcGroupRoleId)) {
          groupedMappings.set(mapping.vrcGroupRoleId, []);
        }
        const roleList = groupedMappings.get(mapping.vrcGroupRoleId);
        if (roleList) {
          roleList.push(mapping.discordRoleId);
        }
      }

      const mappingList = Array.from(groupedMappings.entries())
        .map(([vrcRoleId, discordRoleIds]) => {
          const discordRoles = discordRoleIds.map((id) => `<@&${id}>`).join(", ");
          return `**VRChat Role:** \`${vrcRoleId}\`\n└ Discord Role(s): ${discordRoles}`;
        })
        .join("\n\n");

      const embed = new EmbedBuilder()
        .setTitle("Discord → VRChat Group Role Mappings")
        .setDescription(mappingList)
        .addFields({
          name: "ℹ️ How it works",
          value: "Users with any of the Discord roles will be assigned the corresponding VRChat group role.",
        })
        .setColor(Colors.Blue)
        .setFooter({
          text: `${groupedMappings.size} VRChat role(s) mapped | S.H.I.E.L.D. Bot`,
        })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error: unknown) {
      loggers.bot.error("Error listing mappings", error);
      await interaction.reply({
        content: `❌ Failed to list mappings: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "fetch-roles",
    description: "Fetch and display all roles from the VRChat group",
  })
  async fetchRoles(interaction: CommandInteraction): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      if (!settings?.vrcGroupId) {
        await interaction.editReply({
          content:
            "❌ No VRChat group ID configured. Please set it first using `/settings group set-group-id`.",
        });
        return;
      }

      // Fetch roles from VRChat API
      const roles = await getGroupRoles(settings.vrcGroupId);

      if (!roles || !Array.isArray(roles) || roles.length === 0) {
        await interaction.editReply({
          content: "ℹ️ No roles found in the VRChat group.",
        });
        return;
      }

      // Format roles for display
      const roleList = roles
        .map((role: { name?: string; id?: string; isSelfAssignable?: boolean; requiresTwoFactor?: boolean; order?: number }) => {
          const type = role.isSelfAssignable
            ? "Self-Assignable"
            : role.requiresTwoFactor
              ? "Requires 2FA"
              : role.order !== undefined
                ? `Order: ${role.order}`
                : "Member Role";
          return `**${role.name}**\n└ ID: \`${role.id}\`\n└ ${type}`;
        })
        .join("\n\n");

      const embed = new EmbedBuilder()
        .setTitle(`VRChat Group Roles (${Array.isArray(roles) ? roles.length : 0})`)
        .setDescription(roleList)
        .setColor(Colors.Blue)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Role Sync" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error: unknown) {
      loggers.bot.error("Error fetching roles", error);
      await interaction.editReply({
        content: `❌ Failed to fetch roles: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }
}
