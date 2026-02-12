import { Discord, Slash, SlashOption, Guard, SlashGroup } from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  MessageFlags,
  EmbedBuilder,
  Colors,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { VRChatLoginGuard, GuildGuard } from "../../../utility/guards.js";
import { getUserById, searchUsers, isValidVRChatUserId } from "../../../utility/vrchat.js";
import type { VRChatUser } from "../../../utility/vrchat/types.js";

@Discord()
@SlashGroup({
  name: "verify",
  description: "VRChat verification commands.",
})
@SlashGroup("verify")
@Guard(VRChatLoginGuard)
export class VRChatVerifyAccountCommand {
  @Slash({
    name: "account",
    description: "Start the verification process.",
  })
  @Guard(GuildGuard)
  async verify(
    @SlashOption({
      name: "vrc_user",
      description: "Search for your VRChat username or user ID",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    userIdOpt: string,
    interaction: CommandInteraction | AutocompleteInteraction,
  ) {
    if (interaction.isAutocomplete()) {
      return this.autocompleteVerifyVrchatUser(interaction);
    }

    if (!interaction.isCommand()) {
      return;
    }

    const userId = typeof userIdOpt === "string" ? userIdOpt.trim() : "";
    if (!userId) {
      await interaction.reply({
        content: `No VRChat user ID provided. Please try again.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Fetch user details from VRChat API (resolves username to ID if needed)
    let userInfo: VRChatUser | null = null;
    try {
      userInfo = await getUserById(userId);
    } catch {
      userInfo = null;
    }
    if (!userInfo || !userInfo.id) {
      await interaction.reply({
        content: `We couldn't find that VRChat user. You can type your **VRChat username** or use the autocomplete: type a few letters and select your account from the list.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Validate that userInfo.id is a proper user ID format
    if (!isValidVRChatUserId(userInfo.id)) {
      await interaction.reply({
        content: `❌ Invalid VRChat user ID format received from API. Please contact staff.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Is this your VRChat account?`)
      .setDescription(
        `**${userInfo.displayName}** (${userInfo.id})\n\nChoose how you want to add this account:`,
      )
      .setColor(Colors.Blue)
      .setImage(
        userInfo.profilePicOverride ||
        userInfo.currentAvatarImageUrl ||
        userInfo.currentAvatarThumbnailImageUrl ||
        null,
      )
      .setThumbnail(userInfo.userIcon || userInfo.profilePicOverride || null)
      .setFooter({ text: "VRChat Account Binding" });

    // Use the discord and VRChat IDs in the confirm button's custom_id
    // userInfo.id is guaranteed to be a valid user ID format at this point
    const addUnverifiedBtn = new ButtonBuilder()
      .setCustomId(`vrchat-add:${interaction.user.id}:${userInfo.id}`)
      .setLabel("Add unverified (can be taken over)")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⚠️");

    const verifyBtn = new ButtonBuilder()
      .setCustomId(`vrchat-verify:${interaction.user.id}:${userInfo.id}`)
      .setLabel("Add and verify (protected)")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🔒");

    const tryAgainBtn = new ButtonBuilder()
      .setCustomId("vrchat-verify-try-again")
      .setLabel("Try again")
      .setStyle(ButtonStyle.Secondary);

    const row = {
      type: 1,
      components: [addUnverifiedBtn, verifyBtn, tryAgainBtn],
    };
    await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  }

  async autocompleteVerifyVrchatUser(interaction: AutocompleteInteraction) {
    const query = interaction.options.getFocused();
    if (!query || query.length < 2) {
      return await interaction.respond([]);
    }

    try {
      const users = await searchUsers({ search: query, n: 25 });

      // Filter and sort results based on relevance to the query
      const filteredUsers = users
        .filter((user: VRChatUser) => {
          const displayName = user.displayName?.toLowerCase() || "";
          const userId = user.id?.toLowerCase() || "";
          const queryLower = query.toLowerCase();

          // Match if query appears in display name or user ID
          return (
            displayName.includes(queryLower) || userId.includes(queryLower)
          );
        })
        .sort((a: VRChatUser, b: VRChatUser) => {
          const queryLower = query.toLowerCase();
          const aDisplayName = a.displayName?.toLowerCase() || "";
          const bDisplayName = b.displayName?.toLowerCase() || "";
          const aUserId = a.id?.toLowerCase() || "";
          const bUserId = b.id?.toLowerCase() || "";

          // Prioritize exact matches in display name
          if (aDisplayName === queryLower) {return -1;}
          if (bDisplayName === queryLower) {return 1;}

          // Then prioritize matches that start with the query in display name
          if (
            aDisplayName.startsWith(queryLower) &&
            !bDisplayName.startsWith(queryLower)
          )
            {return -1;}
          if (
            bDisplayName.startsWith(queryLower) &&
            !aDisplayName.startsWith(queryLower)
          )
            {return 1;}

          // Then prioritize exact matches in user ID
          if (aUserId === queryLower) {return -1;}
          if (bUserId === queryLower) {return 1;}

          // Then prioritize matches that start with the query in user ID
          if (aUserId.startsWith(queryLower) && !bUserId.startsWith(queryLower))
            {return -1;}
          if (bUserId.startsWith(queryLower) && !aUserId.startsWith(queryLower))
            {return 1;}

          // Finally, sort alphabetically by display name
          return aDisplayName.localeCompare(bDisplayName);
        });

      const choices = filteredUsers.slice(0, 25).map((user: VRChatUser) => {
        // VRChat display names are max 16 characters, but truncate just in case
        const displayName =
          user.displayName?.slice(0, 16) ||
          "Unknown (Unable to fetch username)";
        // Discord autocomplete choice names have a 100 character limit
        // Format: "DisplayName (usr_12345678-1234-1234-1234-123456789abc)"
        const choiceName = `${displayName} (${user.id})`;

        return {
          name: choiceName.slice(0, 100), // Ensure we don't exceed Discord's limit
          value: user.id,
        };
      });

      return await interaction.respond(choices);
    } catch {
      return await interaction.respond([]);
    }
  }
}
