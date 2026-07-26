import { ContextMenu, Discord, Slash, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  CommandInteraction,
  MessageFlags,
  User,
  UserContextMenuCommandInteraction,
} from "discord.js";
import { replyWithUserLocalTime } from "../../utility/localTime.js";

@Discord()
export class LocalTimeCommands {
  @Slash({
    name: "local-time",
    description: "See what time it is for a member right now",
  })
  async localTime(
    @SlashOption({
      name: "user",
      description: "Member whose local time to show",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (user.bot) {
      await interaction.reply({
        content: "❌ Bots don't have timezones.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await replyWithUserLocalTime(interaction, user);
  }

  @ContextMenu({
    name: "View local time",
    type: ApplicationCommandType.User,
  })
  async viewLocalTimeContext(
    interaction: UserContextMenuCommandInteraction,
  ): Promise<void> {
    const user = interaction.targetUser;

    if (user.bot) {
      await interaction.reply({
        content: "❌ Bots don't have timezones.",
      });
      return;
    }

    await replyWithUserLocalTime(interaction, user, false);
  }
}
