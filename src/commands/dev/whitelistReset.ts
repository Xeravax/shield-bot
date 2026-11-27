import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { BotOwnerGuard } from "../../utility/guards.js";
import { whitelistManager } from "../../managers/whitelist/whitelistManager.js";
import { loggers } from "../../utility/logger.js";

const MAX_HOLD_SECONDS = 300;

@Discord()
@SlashGroup({ name: "dev", description: "Development and debugging commands (Bot Owner only)" })
@SlashGroup("dev")
@Guard(BotOwnerGuard)
export class WhitelistResetCommand {
  @Slash({
    name: "whitelist-reset",
    description: "Clear the whitelist on GitHub + API, then regenerate it from the database (Bot Owner only)",
  })
  async whitelistReset(
    @SlashOption({
      name: "confirm",
      description: "Set to true to confirm. The published whitelist is empty until it is regenerated.",
      type: ApplicationCommandOptionType.Boolean,
      required: true,
    })
    confirm: boolean,
    @SlashOption({
      name: "guild_id",
      description: "Guild whose whitelist to reset (defaults to this server)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    guildIdOption: string | undefined,
    @SlashOption({
      name: "hold_seconds",
      description: `How long to keep it empty before regenerating (0-${MAX_HOLD_SECONDS}, default 0)`,
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 0,
      maxValue: MAX_HOLD_SECONDS,
    })
    holdSeconds: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!confirm) {
      await interaction.editReply({
        content: "Cancelled. Run again with `confirm: True` to clear and regenerate the whitelist.",
      });
      return;
    }

    const guildId = guildIdOption?.trim() || interaction.guildId;
    if (!guildId) {
      await interaction.editReply({
        content: "No guild given. Run this in a server or pass `guild_id`.",
      });
      return;
    }

    const hold = Math.min(Math.max(holdSeconds ?? 0, 0), MAX_HOLD_SECONDS);
    await interaction.editReply({
      content: `Clearing the whitelist for \`${guildId}\` on GitHub and the API${hold ? `, holding for ${hold}s,` : ""} then regenerating... (database is not touched)`,
    });

    try {
      const result = await whitelistManager.resetAndRegenerate(
        guildId,
        hold * 1000,
        interaction.user.tag,
      );

      const describe = (step: { updated: boolean; commitSha?: string; error?: string }) =>
        step.error
          ? `❌ ${step.error}`
          : step.updated
            ? `✅ committed${step.commitSha ? ` \`${step.commitSha.slice(0, 7)}\`` : ""}`
            : "⚠️ no commit (GitHub file already matched)";

      const failed = Boolean(result.regenerate.error);
      const embed = new EmbedBuilder()
        .setTitle(failed ? "⚠️ Whitelist reset incomplete" : "✅ Whitelist reset and regenerated")
        .setColor(failed ? 0xed4245 : 0x57f287)
        .addFields(
          { name: "Guild", value: `\`${guildId}\``, inline: true },
          { name: "Users in regenerated list", value: String(result.userCount), inline: true },
          { name: "Hold", value: `${hold}s`, inline: true },
          { name: "Clear (GitHub)", value: describe(result.clear) },
          { name: "Regenerate (GitHub)", value: describe(result.regenerate) },
        )
        .setFooter({
          text: failed
            ? "The API serves the full list again, but GitHub may still hold the empty list. Re-run or use /whitelist generate."
            : "API endpoints serve the regenerated list. Database unchanged.",
        })
        .setTimestamp();

      await interaction.editReply({ content: "", embeds: [embed] });
    } catch (error) {
      loggers.bot.error("Whitelist reset failed", error);
      await interaction.editReply({
        content: `❌ Whitelist reset failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}
