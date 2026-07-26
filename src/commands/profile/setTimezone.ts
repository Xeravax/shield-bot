import {
  Discord,
  Slash,
  SlashGroup,
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
  resolveTimezoneInput,
  searchTimezones,
  setUserTimezone,
} from "../../utility/userPreferences.js";
import { formatCurrentTimeInTimezone } from "../../utility/localTime.js";
import { EVENT_TIMEZONE } from "../../utility/estTime.js";

/** @deprecated Prefer top-level `/timezone` — kept for compatibility. */
@Discord()
@SlashGroup("profile")
export class ProfileTimezoneCommands {
  @Slash({
    name: "set-timezone",
    description: "Set your timezone (same as /timezone)",
  })
  async setTimezone(
    @SlashOption({
      name: "timezone",
      description: "Region, city, GMT+10, UTC-5, or abbreviation",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: function (
        this: ProfileTimezoneCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteTimezone(interaction);
      },
    })
    timezone: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      const resolved = resolveTimezoneInput(timezone);
      if (!resolved) {
        await interaction.reply({
          content:
            "❌ Invalid timezone. Pick from autocomplete — try a city (`Sydney`), offset (`GMT+10` / `UTC-5`), or abbreviation (`EST`).",
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
          `Tip: you can also use \`/timezone\` (view or set) and \`/local-time\` to check someone else's time.`,
      });
    } catch (error) {
      loggers.bot.error("Error setting user timezone", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: "❌ Failed to save your timezone. Please try again.",
        });
      } else {
        await interaction.reply({
          content: "❌ Failed to save your timezone. Please try again.",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
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
