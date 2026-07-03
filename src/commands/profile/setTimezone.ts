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
  isValidTimezone,
  searchTimezones,
  setUserTimezone,
} from "../../utility/userPreferences.js";
import { EVENT_TIMEZONE } from "../../utility/estTime.js";

@Discord()
@SlashGroup("profile")
export class ProfileTimezoneCommands {
  @Slash({
    name: "set-timezone",
    description: "Set your timezone for natural-language time input",
  })
  async setTimezone(
    @SlashOption({
      name: "timezone",
      description: "IANA timezone (e.g. America/Los_Angeles, Europe/London)",
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
      if (!isValidTimezone(timezone)) {
        await interaction.reply({
          content:
            "❌ Invalid timezone. Pick a value from autocomplete (IANA format, e.g. `America/New_York`).",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await setUserTimezone(interaction.user.id, timezone);

      const display = formatTimezoneDisplay(timezone);
      const defaultNote =
        timezone === EVENT_TIMEZONE
          ? ""
          : `\nEvent scheduling rules (Monday ban, weekly limits) still use **EST**.`;

      await interaction.reply({
        content:
          `✅ Your timezone is set to **${display}**.\n` +
          `Natural-language times (e.g. "Saturday 8pm") will be interpreted in this timezone. ` +
          `Unix timestamps are always absolute.${defaultNote}\n\n` +
          `Use \`/profile settings\` to manage all your preferences.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error("Error setting user timezone", error);
      await interaction.reply({
        content: "❌ Failed to save your timezone. Please try again.",
        flags: MessageFlags.Ephemeral,
      });
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
