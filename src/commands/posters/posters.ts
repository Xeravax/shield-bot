import {
  ApplicationCommandOptionType,
  Attachment,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption, Guard } from "discordx";
import {
  PosterFrameError,
  PosterValidationError,
  posterManager,
} from "../../managers/posters/posterManager.js";
import { POSTERS_MAX_SLOTS } from "../../managers/posters/posterManifest.js";
import { PermissionNodeGuardAny } from "../../utility/guards.js";
import { loggers } from "../../utility/logger.js";

@Discord()
@SlashGroup({
  name: "poster",
  description: "Community Board poster management",
})
@SlashGroup("poster")
export class PosterCommands {
  @Slash({ name: "set", description: "Upload or replace a poster slot" })
  @Guard(
    PermissionNodeGuardAny("posters.command.set", "dashboard.roles.staff"),
  )
  async set(
    @SlashOption({
      name: "slot",
      description: `Poster slot index (0-${POSTERS_MAX_SLOTS - 1})`,
      required: true,
      type: ApplicationCommandOptionType.Integer,
      minValue: 0,
      maxValue: POSTERS_MAX_SLOTS - 1,
    })
    slot: number,
    @SlashOption({
      name: "title",
      description: "Display title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    @SlashOption({
      name: "image",
      description: "Poster image (PNG, JPEG, or WebP)",
      required: true,
      type: ApplicationCommandOptionType.Attachment,
    })
    image: Attachment,
    @SlashOption({
      name: "id",
      description: "Optional slug id (defaults from title)",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    id: string | null,
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
      const response = await fetch(image.url);
      if (!response.ok) {
        await interaction.editReply({
          content: `❌ Failed to download attachment (${response.status}).`,
        });
        return;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const result = await posterManager.setPoster({
        guildId: interaction.guildId,
        slot,
        title,
        id,
        image: buffer,
        mimeType: image.contentType,
        updatedBy: interaction.user.id,
      });

      const entry = result.manifest.posters.find((p) => p.slot === slot);
      await interaction.editReply({
        content: [
          `✅ Poster slot **${slot}** updated.`,
          `Version: **${result.manifest.version}**`,
          `Id: \`${entry?.id ?? "?"}\``,
          `Title: ${entry?.title ?? title}`,
          `Enabled: ${entry?.enabled ? "yes" : "no"}`,
          `Image: ${result.imageUrl}`,
          result.commitSha ? `Commit: \`${result.commitSha.slice(0, 7)}\`` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
    } catch (error: unknown) {
      await this.replyError(interaction, "setting poster", error);
    }
  }

  @Slash({ name: "disable", description: "Disable a poster slot (keeps JPEG)" })
  @Guard(
    PermissionNodeGuardAny("posters.command.disable", "dashboard.roles.staff"),
  )
  async disable(
    @SlashOption({
      name: "slot",
      description: `Poster slot index (0-${POSTERS_MAX_SLOTS - 1})`,
      required: true,
      type: ApplicationCommandOptionType.Integer,
      minValue: 0,
      maxValue: POSTERS_MAX_SLOTS - 1,
    })
    slot: number,
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
      const result = await posterManager.updatePosterMeta({
        guildId: interaction.guildId,
        slot,
        enabled: false,
        updatedBy: interaction.user.id,
        commitMessage: `chore(posters): disable slot ${slot}`,
      });
      await interaction.editReply({
        content: `✅ Slot **${slot}** disabled (v${result.manifest.version}). JPEG kept at ${result.imageUrl}`,
      });
    } catch (error: unknown) {
      await this.replyError(interaction, "disabling poster", error);
    }
  }

  @Slash({ name: "enable", description: "Enable a poster slot" })
  @Guard(
    PermissionNodeGuardAny("posters.command.enable", "dashboard.roles.staff"),
  )
  async enable(
    @SlashOption({
      name: "slot",
      description: `Poster slot index (0-${POSTERS_MAX_SLOTS - 1})`,
      required: true,
      type: ApplicationCommandOptionType.Integer,
      minValue: 0,
      maxValue: POSTERS_MAX_SLOTS - 1,
    })
    slot: number,
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
      const result = await posterManager.updatePosterMeta({
        guildId: interaction.guildId,
        slot,
        enabled: true,
        updatedBy: interaction.user.id,
        commitMessage: `chore(posters): enable slot ${slot}`,
      });
      await interaction.editReply({
        content: `✅ Slot **${slot}** enabled (v${result.manifest.version}). Image: ${result.imageUrl}`,
      });
    } catch (error: unknown) {
      await this.replyError(interaction, "enabling poster", error);
    }
  }

  @Slash({ name: "list", description: "List poster slots and public URLs" })
  @Guard(
    PermissionNodeGuardAny("posters.command.list", "dashboard.roles.staff"),
  )
  async list(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId) {
      await interaction.editReply({
        content: "❌ This command can only be used in a server.",
      });
      return;
    }

    try {
      const list = await posterManager.listForStaff(interaction.guildId);
      const lines = list.posters.map(
        (p) =>
          `• **${p.slot}** \`${p.id}\` — ${p.title} — ${p.enabled ? "enabled" : "disabled"}\n  ${p.imageUrl}`,
      );
      await interaction.editReply({
        content: [
          `**Community Board posters** (v${list.version})`,
          `Updated: ${list.updatedAt}`,
          `JSON: ${list.jsonUrl}`,
          "",
          ...lines,
        ].join("\n"),
      });
    } catch (error: unknown) {
      await this.replyError(interaction, "listing posters", error);
    }
  }

  @Slash({
    name: "force-update",
    description: "Republish station/poster.json from the database",
  })
  @Guard(
    PermissionNodeGuardAny(
      "posters.command.force-update",
      "dashboard.roles.staff",
    ),
  )
  async forceUpdate(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId) {
      await interaction.editReply({
        content: "❌ This command can only be used in a server.",
      });
      return;
    }

    try {
      const result = await posterManager.forceUpdate(interaction.guildId);
      await interaction.editReply({
        content: [
          `✅ Republished \`station/poster.json\` (v${result.manifest.version}).`,
          `URL: ${result.jsonUrl}`,
          result.commitSha ? `Commit: \`${result.commitSha.slice(0, 7)}\`` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
    } catch (error: unknown) {
      await this.replyError(interaction, "force-updating posters", error);
    }
  }

  private async replyError(
    interaction: CommandInteraction,
    action: string,
    error: unknown,
  ): Promise<void> {
    if (
      error instanceof PosterValidationError ||
      error instanceof PosterFrameError
    ) {
      await interaction.editReply({ content: `❌ ${error.message}` });
      return;
    }
    loggers.bot.error(`Error ${action}`, error);
    await interaction.editReply({
      content: `❌ Error ${action}: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }
}
