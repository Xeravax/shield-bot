import { Discord, Slash, SlashGroup } from "discordx";
import { CommandInteraction, EmbedBuilder, MessageFlags } from "discord.js";
import { Pagination } from "@discordx/pagination";
import { BotOwnerGuard } from "../../utility/guards.js";
import { Guard } from "discordx";
import { bot } from "../../main.js";

const SERVERS_PER_PAGE = 15;

@Discord()
@SlashGroup({
  name: "dev",
  description: "Development and debugging commands (Bot Owner only)",
})
@SlashGroup("dev")
@Guard(BotOwnerGuard)
export class ServersCommand {
  @Slash({
    name: "servers",
    description: "List all servers the bot is in (name, owner, member count)",
  })
  async servers(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guilds = [...bot.guilds.cache.values()].sort(
      (a, b) => b.memberCount - a.memberCount,
    );

    if (guilds.length === 0) {
      await interaction.editReply({
        content: "The bot is not in any servers.",
      });
      return;
    }

    const totalMembers = guilds.reduce((acc, g) => acc + g.memberCount, 0);
    const totalPages = Math.ceil(guilds.length / SERVERS_PER_PAGE);
    const pages: Array<{ embeds: EmbedBuilder[] }> = [];

    for (let i = 0; i < guilds.length; i += SERVERS_PER_PAGE) {
      const chunk = guilds.slice(i, i + SERVERS_PER_PAGE);
      const description = chunk
        .map((g, idx) => {
          const n = i + idx + 1;
          const owner = g.ownerId ? `<@${g.ownerId}>` : "—";
          return `**${n}.** **${escapeMarkdown(g.name)}** (\`${g.id}\`)\n Owner: ${owner} · Members: **${g.memberCount.toLocaleString()}**`;
        })
        .join("\n\n");

      const embed = new EmbedBuilder()
        .setTitle("Servers")
        .setDescription(description)
        .setColor(0x5865f2)
        .setFooter({
          text: `Page ${Math.floor(i / SERVERS_PER_PAGE) + 1} of ${totalPages} · ${guilds.length} server(s) · ${totalMembers.toLocaleString()} total members`,
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
        } catch {
          // ignore
        }
      },
    });

    await pagination.send();
  }
}

function escapeMarkdown(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("*", "\\*").replaceAll("_", "\\_").replaceAll("`", "\\`").replaceAll("|", "\\|");
}
