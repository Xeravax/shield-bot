import {
  AutocompleteInteraction,
  CommandInteraction,
  Interaction,
  MessageFlags,
} from "discord.js";

const DISCORD_MESSAGE_LINK_RE =
  /(?:https?:\/\/)?(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/i;

export function parseDiscordMessageLink(
  input: string,
): { guildId: string; channelId: string; messageId: string } | null {
  const match = input.trim().match(DISCORD_MESSAGE_LINK_RE);
  if (!match) {
    return null;
  }
  return {
    guildId: match[1],
    channelId: match[2],
    messageId: match[3],
  };
}

export async function respondWithError(
  interaction: Interaction | CommandInteraction | AutocompleteInteraction,
  message: string,
): Promise<void> {
  if (interaction.isAutocomplete()) {
    await interaction.respond([
      {
        name: message,
        value: "error",
      } as const,
    ]);
  } else {
    await interaction.reply({
      content: message,
      flags: MessageFlags.Ephemeral,
    });
  }
  return;
}
