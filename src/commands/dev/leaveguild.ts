import { Discord, Slash, SlashOption, SlashGroup } from "discordx";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import { BotOwnerGuard } from "../../utility/guards.js";
import { Guard } from "discordx";
import { bot } from "../../main.js";

@Discord()
@SlashGroup({ name: "dev", description: "Development and debugging commands (Bot Owner only)" })
@SlashGroup("dev")
@Guard(BotOwnerGuard)
export class LeaveGuildCommand {
  @Slash({
    name: "leaveguild",
    description: "Make the bot leave a guild by ID (Bot Owner only)",
  })
  async leaveguild(
    @SlashOption({
      name: "guild_id",
      description: "The guild ID to leave",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    guildId: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await interaction.deferReply();

    const guild =
      bot.guilds.cache.get(guildId) ??
      (await bot.guilds.fetch(guildId).catch(() => null));

    if (!guild) {
      await interaction.editReply({
        content: "Not in that guild or invalid guild ID.",
      });
      return;
    }

    try {
      await guild.leave();
      await interaction.editReply({
        content: `Left guild **${guild.name}** (\`${guild.id}\`).`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await interaction.editReply({
        content: `Failed to leave guild: ${message}`,
      });
    }
  }
}
