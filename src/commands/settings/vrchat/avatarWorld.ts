import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  MessageFlags,
} from "discord.js";
import { StaffGuard } from "../../../utility/guards.js";
import { patrolTimer, prisma } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
@SlashGroup({ name: "vrchat", description: "VRChat settings", root: "settings" })
@SlashGroup("vrchat", "settings")
@Guard(StaffGuard)
export class VRChatSettingsCommand {
  @Slash({
    name: "avatar-world",
    description: "Set the VRChat world ID for avatar invites",
  })
  async avatarWorld(
    @SlashOption({
      name: "world-id",
      description: "The VRChat world ID (e.g., wrld_xxx). Leave empty to view current setting.",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    worldId: string | undefined,
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

      // If no world ID provided, show current setting
      if (!worldId) {
        const settings = await prisma.guildSettings.findUnique({
          where: { guildId: interaction.guildId },
        });

        if (!settings?.avatarWorldId) {
          await interaction.reply({
            content: "ℹ️ No avatar world is currently configured.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply({
          content: `ℹ️ Avatar world is currently set to: \`${settings.avatarWorldId}\``,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Validate world ID format
      if (!worldId.startsWith("wrld_")) {
        await interaction.reply({
          content: "❌ Invalid world ID format. World IDs should start with `wrld_`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Update the setting
      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: {
          avatarWorldId: worldId,
        },
        create: {
          guildId: interaction.guildId,
          avatarWorldId: worldId,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-vrchat-avatar-world",
        interaction.user.id,
        undefined,
        worldId,
      );

      await interaction.reply({
        content: `✅ Avatar world has been set to: \`${worldId}\``,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error setting avatar world", error);
      await interaction.reply({
        content: `❌ Failed to set avatar world: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    name: "clear-avatar-world",
    description: "Remove the avatar world setting",
  })
  async clearAvatarWorld(interaction: CommandInteraction): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      if (!settings?.avatarWorldId) {
        await interaction.reply({
          content: "ℹ️ No avatar world is currently configured.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.guildSettings.update({
        where: { guildId: interaction.guildId },
        data: {
          avatarWorldId: null,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-vrchat-avatar-world",
        interaction.user.id,
        undefined,
        "cleared",
      );

      await interaction.reply({
        content: "✅ Avatar world setting has been cleared.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error(
        "Error clearing avatar world",
        error,
      );
      await interaction.reply({
        content: `❌ Failed to clear avatar world: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
