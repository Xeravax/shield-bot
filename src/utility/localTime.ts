import {
  CommandInteraction,
  MessageFlags,
  User,
  UserContextMenuCommandInteraction,
} from "discord.js";
import {
  formatTimezoneDisplay,
  getResolvedUserPreferences,
} from "./userPreferences.js";
import { loggers } from "./logger.js";

type TimeLookupInteraction =
  | CommandInteraction
  | UserContextMenuCommandInteraction;

/** Current wall-clock time in an IANA timezone, e.g. "Mon, Jul 27, 2026, 6:53 PM EDT". */
export function formatCurrentTimeInTimezone(
  timezone: string,
  date: Date = new Date(),
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/**
 * Reply with a user's local time, or tell the executor they have not set a timezone.
 * @param ephemeral - When true (slash), only the executor sees the reply.
 */
export async function replyWithUserLocalTime(
  interaction: TimeLookupInteraction,
  targetUser: User,
  ephemeral = true,
): Promise<void> {
  try {
    const prefs = await getResolvedUserPreferences(targetUser.id);
    const isSelf = targetUser.id === interaction.user.id;

    if (!prefs.timezoneStored) {
      const content = isSelf
        ? "❌ You haven't set a timezone yet. Use `/timezone` to set one."
        : `❌ **${targetUser.displayName}** hasn't set a timezone yet. They can set one with \`/timezone\`.`;

      await interaction.reply({
        content,
        ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
      });
      return;
    }

    const localNow = formatCurrentTimeInTimezone(prefs.timezone);
    const display = formatTimezoneDisplay(prefs.timezone);
    const who = isSelf ? "Your" : `**${targetUser.displayName}**'s`;

    await interaction.reply({
      content: `🕐 ${who} local time is **${localNow}**\nTimezone: \`${display}\``,
      ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
    });
  } catch (error) {
    loggers.bot.error("Error looking up user local time", error);
    const content = "❌ Failed to look up that user's local time. Please try again.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  }
}
