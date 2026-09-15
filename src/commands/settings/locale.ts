import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import { PermissionNodeGuard } from "../../utility/permissionNodes.js";
import { prisma } from "../../main.js";
import { loggers } from "../../utility/logger.js";
import {
  DEFAULT_LOCALE,
  descriptionLocalizationsForKey,
  getLocalePickerOptions,
  isAvailableLocale,
  localePickerLabel,
  t,
  type LocaleOption,
} from "../../i18n/index.js";
import { resolveLocale } from "../../i18n/resolveLocale.js";
import { refreshGuildLocaleLabels } from "../../i18n/refreshGuildLabels.js";

@Discord()
@SlashGroup("settings")
@Guard(PermissionNodeGuard("settings.command.locale"))
export class SettingsLocaleCommand {
  @Slash({
    name: "locale",
    description: "Set the default language for this server",
    descriptionLocalizations: descriptionLocalizationsForKey("slash.settings.locale"),
  })
  async setLocale(
    @SlashOption({
      name: "language",
      description: "Server default language",
      descriptionLocalizations: descriptionLocalizationsForKey(
        "slash.settings.localeOption",
      ),
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: true,
    })
    language: string | undefined,
    interaction: CommandInteraction | AutocompleteInteraction,
  ): Promise<void> {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused().toLowerCase();
      const choices = [
        { name: "Reset to English (US)", value: "reset" },
        ...getLocalePickerOptions().map((o: LocaleOption) => ({
          name: o.label.slice(0, 100),
          value: o.code,
        })),
      ].filter(
        (c) =>
          !focused ||
          c.name.toLowerCase().includes(focused) ||
          c.value.toLowerCase().includes(focused),
      );
      await interaction.respond(choices.slice(0, 25));
      return;
    }

    if (!interaction.guildId) {
      const locale = await resolveLocale({ userId: interaction.user.id });
      await interaction.reply({
        content: t(locale, "common.guildOnly"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const replyLocale = await resolveLocale({
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });

    try {
      if (!language) {
        const settings = await prisma.guildSettings.findUnique({
          where: { guildId: interaction.guildId },
          select: { locale: true },
        });
        const current =
          settings?.locale && isAvailableLocale(settings.locale)
            ? settings.locale
            : DEFAULT_LOCALE;
        await interaction.reply({
          content: t(replyLocale, "settings.locale.current", {
            label: localePickerLabel(current),
          }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (language === "reset") {
        await prisma.guildSettings.upsert({
          where: { guildId: interaction.guildId },
          update: { locale: null },
          create: { guildId: interaction.guildId, locale: null },
        });
        await refreshGuildLocaleLabels(interaction.guildId, DEFAULT_LOCALE);
        await interaction.reply({
          content: t(replyLocale, "settings.locale.cleared"),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!isAvailableLocale(language)) {
        await interaction.reply({
          content: t(replyLocale, "settings.locale.invalid"),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: { locale: language },
        create: { guildId: interaction.guildId, locale: language },
      });
      await refreshGuildLocaleLabels(interaction.guildId, language);
      await interaction.reply({
        content: t(replyLocale, "settings.locale.set", {
          label: localePickerLabel(language),
        }),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error("Error setting guild locale", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: t(replyLocale, "settings.locale.failed"),
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
}
