import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption, Guard } from "discordx";
import { prisma } from "../../main.js";
import { GitHubPublisher } from "../../managers/whitelist/githubPublisher.js";
import { PermissionNodeGuard } from "../../utility/guards.js";
import { loggers } from "../../utility/logger.js";

@Discord()
@SlashGroup({
  name: "rooftop",
  description: "Rooftop file management commands",
})
@SlashGroup("rooftop")
export class RooftopCommands {
  private githubPublisher = new GitHubPublisher();

  @Slash({ name: "force-update", description: "Force update rooftop files on GitHub" })
  @Guard(PermissionNodeGuard("rooftop.command.force-update"))
  async forceUpdate(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guildId) {
      await interaction.editReply({
        content: "❌ This command can only be used in a server.",
      });
      return;
    }

    try {
      const result = await this.githubPublisher.updateRepositoryWithRooftopFiles(
        interaction.guildId,
        `chore(rooftop): force update rooftop files`,
      );

      if (result.updated) {
        await interaction.editReply({
          content: `✅ Successfully updated rooftop files on GitHub.\nCommit: ${result.commitSha}\nFiles: ${result.paths?.join(", ")}`,
        });
      } else {
        await interaction.editReply({
          content: "❌ Failed to update rooftop files on GitHub.",
        });
      }
    } catch (error: unknown) {
      loggers.bot.error("Error forcing rooftop files update", error);
      await interaction.editReply({
        content: `❌ Error updating rooftop files: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({ description: "Add a new announcement" })
  @Guard(PermissionNodeGuard("rooftop.command.announcement"))
  async announcement(
    @SlashOption({
      description: "The announcement text to add",
      name: "content",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    content: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guildId) {
      await interaction.editReply({
        content: "❌ This command can only be used in a server.",
      });
      return;
    }

    try {
      if (!content || content.trim().length === 0) {
        await interaction.editReply({
          content: "❌ Announcement content cannot be empty.",
        });
        return;
      }

      const announcement = await prisma.announcement.create({
        data: {
          content: content.trim(),
          createdBy: interaction.user.id,
        },
      });

      // Update GitHub files after adding announcement
      try {
        await this.githubPublisher.updateRepositoryWithRooftopFiles(
          interaction.guildId,
          `chore(rooftop): add announcement`,
        );
      } catch (error) {
        loggers.bot.warn("Error updating rooftop files after announcement creation", error);
      }

      await interaction.editReply({
        content: `✅ Announcement added successfully!\nID: ${announcement.id}\nContent: ${announcement.content}`,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error creating announcement", error);
      await interaction.editReply({
        content: `❌ Error creating announcement: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({ description: "Add a new spin the bottle response" })
  @Guard(PermissionNodeGuard("rooftop.command.spinthebottle"))
  async spinthebottle(
    @SlashOption({
      description: "The spin the bottle response text to add",
      name: "content",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    content: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guildId) {
      await interaction.editReply({
        content: "❌ This command can only be used in a server.",
      });
      return;
    }

    try {
      if (!content || content.trim().length === 0) {
        await interaction.editReply({
          content: "❌ Spin the bottle response content cannot be empty.",
        });
        return;
      }

      const response = await prisma.spinTheBottleResponse.create({
        data: {
          content: content.trim(),
          createdBy: interaction.user.id,
        },
      });

      // Update GitHub files after adding response
      try {
        await this.githubPublisher.updateRepositoryWithRooftopFiles(
          interaction.guildId,
          `chore(rooftop): add spin the bottle response`,
        );
      } catch (error) {
        loggers.bot.warn("Error updating rooftop files after spin the bottle response creation", error);
      }

      await interaction.editReply({
        content: `✅ Spin the bottle response added successfully!\nID: ${response.id}\nContent: ${response.content}`,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error creating spin the bottle response", error);
      await interaction.editReply({
        content: `❌ Error creating spin the bottle response: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }
}

