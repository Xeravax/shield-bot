import {
  Discord,
  Slash,
  SlashOption,
} from "discordx";
import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import { loggers } from "../../utility/logger.js";
import {
  formatTimezoneDisplay,
  getResolvedUserPreferences,
  resolveTimezoneInput,
  searchTimezones,
  setUserTimezone,
} from "../../utility/userPreferences.js";
import { formatCurrentTimeInTimezone } from "../../utility/localTime.js";
import { EVENT_TIMEZONE } from "../../utility/estTime.js";

@Discord()
export class TimezoneCommand {
  @Slash({
    name: "timezone",
    description: "Set or view your timezone (used for local time and event scheduling)",
  })
  async timezone(
    @SlashOption({
      name: "timezone",
      description: "Region, city, GMT+10, UTC-5, or abbreviation. Omit to view yours.",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: function (
        this: TimezoneCommand,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteTimezone(interaction);
      },
    })
    timezone: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      if (!timezone) {
        await this.viewOwnTimezone(interaction);
        return;
      }

      const resolved = resolveTimezoneInput(timezone);
      if (!resolved) {
        await interaction.reply({
          content:
            "❌ Invalid timezone. Pick from autocomplete - try a city (`Sydney`), offset (`GMT+10` / `UTC-5`), or abbreviation (`EST`).",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await setUserTimezone(interaction.user.id, resolved);

      const display = formatTimezoneDisplay(resolved);
      const localNow = formatCurrentTimeInTimezone(resolved);
      const defaultNote =
        resolved === EVENT_TIMEZONE
          ? ""
          : `\nEvent scheduling rules (Monday ban, weekly limits) still use **EST**.`;

      await interaction.editReply({
        content:
          `✅ Your timezone is set to **${display}**.\n` +
          `It is currently **${localNow}** there.\n` +
          `Natural-language times (e.g. "Saturday 8pm") will be interpreted in this timezone. ` +
          `Unix timestamps are always absolute.${defaultNote}\n\n` +
          `Others can check your local time with \`/local-time\` or the **View local time** user menu.`,
      });
    } catch (error) {
      loggers.bot.error("Error in /timezone", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "❌ Failed to update your timezone. Please try again.",
        });
      } else {
        await interaction.reply({
          content: "❌ Failed to update your timezone. Please try again.",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  private async viewOwnTimezone(interaction: CommandInteraction): Promise<void> {
    const prefs = await getResolvedUserPreferences(interaction.user.id);

    if (!prefs.timezoneStored) {
      await interaction.reply({
        content:
          "❌ You haven't set a timezone yet.\n" +
          "Use `/timezone timezone:<region>` (autocomplete) to set one - e.g. `America/New_York` or `Europe/Amsterdam`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const display = formatTimezoneDisplay(prefs.timezone);
    const localNow = formatCurrentTimeInTimezone(prefs.timezone);

    await interaction.reply({
      content:
        `🕐 Your local time is **${localNow}**\n` +
        `Timezone: \`${display}\`\n\n` +
        `Change it with \`/timezone timezone:<region>\`, or manage preferences via \`/profile settings\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  async autocompleteTimezone(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused();
    const choices = searchTimezones(focused).map((tz) => ({
      name: formatTimezoneDisplay(tz),
      value: tz,
    }));
    await interaction.respond(choices);
  }
}
