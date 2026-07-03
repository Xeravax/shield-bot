import {
  Discord,
  Guard,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  Role,
} from "discord.js";
import { prisma } from "../../main.js";
import {
  ALL_GRANTABLE_NODES,
  invalidatePermissionNodeCache,
  isValidGrantNode,
  PermissionNodeGuard,
  hasNode,
} from "../../utility/permissionNodes.js";
import { resolveGuildMember } from "../../utility/guards.js";
import { loggers } from "../../utility/logger.js";

const MAX_CHOICES = 25;

function nodeChoices(query: string): { name: string; value: string }[] {
  const q = query.toLowerCase();
  return ALL_GRANTABLE_NODES.filter((node) => node.includes(q))
    .slice(0, MAX_CHOICES)
    .map((node) => ({ name: node, value: node }));
}

@Discord()
@SlashGroup({
  name: "permissions",
  description: "Manage role permission nodes",
})
@SlashGroup("permissions")
@Guard(PermissionNodeGuard("permissions.manage"))
export class PermissionsCommands {
  private async canAutocompleteManage(interaction: AutocompleteInteraction): Promise<boolean> {
    if (!interaction.guildId || !interaction.guild) {
      return false;
    }
    const member = await resolveGuildMember(interaction);
    if (!member) {
      return false;
    }
    return hasNode(member, "permissions.manage");
  }

  @Slash({
    name: "grant",
    description: "Grant a permission node to a role",
  })
  async grant(
    @SlashOption({
      name: "role",
      description: "The role to grant the node to",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    role: Role,
    @SlashOption({
      name: "node",
      description: "Permission node (supports wildcards like patrol.*)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: function (
        this: PermissionsCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteNode(interaction);
      },
    })
    node: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      if (!interaction.guildId) {
        return;
      }

      if (!isValidGrantNode(node)) {
        await interaction.reply({
          content: `❌ Unknown permission node: \`${node}\`. Use the autocomplete suggestions.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const existing = await prisma.rolePermission.findUnique({
        where: {
          guildId_roleId_node: {
            guildId: interaction.guildId,
            roleId: role.id,
            node,
          },
        },
      });

      if (existing) {
        await interaction.reply({
          content: `ℹ️ <@&${role.id}> already has \`${node}\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.rolePermission.create({
        data: {
          guildId: interaction.guildId,
          roleId: role.id,
          node,
        },
      });
      invalidatePermissionNodeCache(interaction.guildId);

      await interaction.reply({
        content: `✅ Granted \`${node}\` to <@&${role.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error granting permission node", error);
      await interaction.reply({
        content: "❌ Failed to grant permission node. Please try again.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "revoke",
    description: "Revoke a permission node from a role",
  })
  async revoke(
    @SlashOption({
      name: "role",
      description: "The role to revoke the node from",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    role: Role,
    @SlashOption({
      name: "node",
      description: "Permission node to revoke",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: function (
        this: PermissionsCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteGrantedNode(interaction);
      },
    })
    node: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      if (!interaction.guildId) {
        return;
      }

      const deleted = await prisma.rolePermission.deleteMany({
        where: {
          guildId: interaction.guildId,
          roleId: role.id,
          node,
        },
      });
      invalidatePermissionNodeCache(interaction.guildId);

      if (deleted.count === 0) {
        await interaction.reply({
          content: `ℹ️ <@&${role.id}> does not have \`${node}\`.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        content: `✅ Revoked \`${node}\` from <@&${role.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error revoking permission node", error);
      await interaction.reply({
        content: "❌ Failed to revoke permission node. Please try again.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "list",
    description: "List permission node grants",
  })
  async list(
    @SlashOption({
      name: "role",
      description: "Only show grants for this role",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    role: Role | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      if (!interaction.guildId) {
        return;
      }

      const grants = await prisma.rolePermission.findMany({
        where: {
          guildId: interaction.guildId,
          ...(role ? { roleId: role.id } : {}),
        },
        orderBy: [{ roleId: "asc" }, { node: "asc" }],
      });

      if (grants.length === 0) {
        await interaction.reply({
          content: role
            ? `ℹ️ <@&${role.id}> has no permission nodes.`
            : "ℹ️ No permission nodes have been granted in this server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const byRole = new Map<string, string[]>();
      for (const grant of grants) {
        const nodes = byRole.get(grant.roleId) ?? [];
        nodes.push(grant.node);
        byRole.set(grant.roleId, nodes);
      }

      const embed = new EmbedBuilder()
        .setTitle("Permission Nodes")
        .setColor(0x5865f2);

      // Field value limit is 1024 chars; truncate long node lists per role.
      for (const [roleId, nodes] of byRole) {
        let value = nodes.map((n) => `\`${n}\``).join("\n");
        if (value.length > 1024) {
          value = `${value.slice(0, 1000)}\n… and more`;
        }
        embed.addFields({
          name: interaction.guild?.roles.cache.get(roleId)?.name ?? roleId,
          value,
        });
        if ((embed.data.fields?.length ?? 0) >= 25) {
          break;
        }
      }

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error listing permission nodes", error);
      await interaction.reply({
        content: "❌ Failed to list permission nodes. Please try again.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  async autocompleteNode(interaction: AutocompleteInteraction): Promise<void> {
    if (!(await this.canAutocompleteManage(interaction))) {
      await interaction.respond([]);
      return;
    }
    const query = String(interaction.options.getFocused() ?? "");
    await interaction.respond(nodeChoices(query));
  }

  /** For revoke: prefer nodes actually granted to the selected role. */
  async autocompleteGrantedNode(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    if (!(await this.canAutocompleteManage(interaction))) {
      await interaction.respond([]);
      return;
    }
    const query = String(interaction.options.getFocused() ?? "").toLowerCase();
    const roleId = interaction.options.get("role")?.value;

    if (interaction.guildId && typeof roleId === "string") {
      try {
        const grants = await prisma.rolePermission.findMany({
          where: { guildId: interaction.guildId, roleId },
          select: { node: true },
          orderBy: { node: "asc" },
        });
        if (grants.length > 0) {
          await interaction.respond(
            grants
              .map((g) => g.node)
              .filter((node) => node.includes(query))
              .slice(0, MAX_CHOICES)
              .map((node) => ({ name: node, value: node })),
          );
          return;
        }
      } catch (error) {
        loggers.bot.error("Error autocompleting granted nodes", error);
      }
    }

    await interaction.respond(nodeChoices(query));
  }
}
