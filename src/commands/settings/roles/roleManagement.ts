import {
  Discord,
  Slash,
  SlashGroup,
  SlashOption,
  SlashChoice,
  Guard,
} from "discordx";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  Role,
  MessageFlags,
} from "discord.js";
import { PermissionNodeGuard } from "../../../utility/permissionNodes.js";

const DEPRECATION_MESSAGE =
  "⚠️ `/settings roles` is deprecated. Use `/permissions grant`, `/permissions revoke`, and `/permissions list` to manage permission nodes for roles instead.";

// This class only defines the subgroup commands for settings -> roles
@Discord()
@SlashGroup({
  description: "Role settings (deprecated — use /permissions)",
  name: "roles",
  root: "settings",
})
@SlashGroup("roles", "settings")
@Guard(PermissionNodeGuard("settings.command.roles"))
export class SettingsRolesManagementSubGroup {
  @Slash({ name: "add", description: "Add a role to a permission level (deprecated)" })
  async addRole(
    @SlashChoice(
      "dev-guard",
      "staff",
      "trainer",
      "host-attendance",
      "shield-member",
    )
    @SlashOption({
      name: "type",
      description: "Permission level type",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    _type: string | undefined,
    @SlashOption({
      name: "role",
      description: "Discord role to add",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    _role: Role | undefined,
    interaction: CommandInteraction,
  ) {
    await interaction.reply({
      content: DEPRECATION_MESSAGE,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "remove",
    description: "Remove a role from a permission level (deprecated)",
  })
  async removeRole(
    @SlashChoice(
      "dev-guard",
      "staff",
      "trainer",
      "host-attendance",
      "shield-member",
    )
    @SlashOption({
      name: "type",
      description: "Permission level type",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    _type: string | undefined,
    @SlashOption({
      name: "role",
      description: "Discord role to remove",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    _role: Role | undefined,
    interaction: CommandInteraction,
  ) {
    await interaction.reply({
      content: DEPRECATION_MESSAGE,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "status",
    description: "Show current role mappings (deprecated)",
  })
  async rolesStatus(interaction: CommandInteraction) {
    await interaction.reply({
      content: DEPRECATION_MESSAGE,
      flags: MessageFlags.Ephemeral,
    });
  }
}
