import {
  CommandInteraction,
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  type MessageActionRowComponentBuilder,
  ApplicationCommandOptionType,
  User,
  GuildMember,
} from "discord.js";
import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import { prisma } from "../../../main.js";
import { VRChatLoginGuard, GuildGuard } from "../../../utility/guards.js";
import { userHasPermissionFromRoles, PermissionLevel } from "../../../utility/permissionUtils.js";

@Discord()
@SlashGroup({
  name: "verify",
  description: "VRChat verification commands.",
})
@SlashGroup("verify")
@Guard(VRChatLoginGuard)
export class VRChatVerifyManagerCommand {
  @Slash({
    name: "manage",
    description: "Manage MAIN/ALT status for verified VRChat accounts. Staff can manage any user's accounts.",
  })
  @Guard(GuildGuard)
  async manage(
    @SlashOption({
      name: "user",
      description: "[Staff only] The Discord user whose accounts you want to manage (defaults to yourself)",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    targetUser: User | null,
    interaction: CommandInteraction,
  ) {
    const member = interaction.member as GuildMember;
    if (!member) {
      await interaction.reply({
        content: "Unable to verify your permissions.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if user is staff
    const isStaff = await userHasPermissionFromRoles(member, PermissionLevel.STAFF);
    
    // Determine target user
    let targetDiscordId: string;
    let isManagingSelf = true;
    
    if (targetUser && isStaff) {
      // Staff managing another user
      targetDiscordId = targetUser.id;
      isManagingSelf = false;
    } else if (targetUser && !isStaff) {
      // Non-staff trying to specify a user - ignore and use themselves
      targetDiscordId = interaction.user.id;
    } else {
      // No user specified, use themselves
      targetDiscordId = interaction.user.id;
    }

    const discordId = targetDiscordId;

    // Get all VRChat accounts for this user
    const user = await prisma.user.findUnique({
      where: { discordId },
      include: { vrchatAccounts: true },
    });

    if (!user || !user.vrchatAccounts || user.vrchatAccounts.length === 0) {
      await interaction.reply({
        content: "No VRChat accounts found for your Discord account.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Separate verified and unverified accounts
    const verifiedAccounts = user.vrchatAccounts.filter(
      (acc: { accountType: string }) => acc.accountType === "MAIN" || acc.accountType === "ALT",
    );
    const unverifiedAccounts = user.vrchatAccounts.filter(
      (acc: { accountType: string }) => acc.accountType === "UNVERIFIED",
    );

    if (verifiedAccounts.length === 0 && unverifiedAccounts.length === 0) {
      await interaction.reply({
        content: "No VRChat accounts found for your Discord account.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Build the container using the new structure
    const container = new ContainerBuilder();

    const infoText = isManagingSelf
      ? "**Account Manager**\n- Only **verified** accounts can be set as MAIN/ALT. Unverified accounts have basic whitelist access only.\n- One MAIN account allowed. Deleting an account will unfriend it.\n- Username updates require being friended with the bot."
      : `**Staff Account Manager** - Managing accounts for <@${discordId}>\n- Only **verified** accounts can be set as MAIN/ALT. Unverified accounts have basic whitelist access only.\n- One MAIN account allowed. Deleting an account will unfriend it.\n- Username updates require being friended with the bot.`;

    const buttonCustomId = isManagingSelf ? "accountmanager:info" : "staffaccountmanager:info";

    container.addSectionComponents(
      new SectionBuilder()
        .setButtonAccessory(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setLabel("Info")
            .setEmoji({ name: "ℹ️" })
            .setDisabled(true)
            .setCustomId(buttonCustomId),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(infoText),
        ),
    );

    container.addSeparatorComponents(
      new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true),
    );

    // Show verified accounts first
    if (verifiedAccounts.length > 0) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent("**🔒 Verified Accounts**"),
      );

      for (const acc of verifiedAccounts) {
        const profileLink = `<https://vrchat.com/home/user/${acc.vrcUserId}>`;
        const displayName = acc.vrchatUsername || acc.vrcUserId;
        const discordPing = `<@${discordId}>`;

        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `[${displayName}](${profileLink}) - Linked to ${discordPing}`,
          ),
        );

        const isMain = acc.accountType === "MAIN";
        const isAlt = acc.accountType === "ALT";

        // Button color/enable logic for verified accounts
        let mainBtnStyle = ButtonStyle.Primary;
        let mainBtnDisabled = false;
        let altBtnStyle = ButtonStyle.Secondary;
        let altBtnDisabled = false;

        if (isMain) {
          mainBtnStyle = ButtonStyle.Success; // Green
          mainBtnDisabled = true;
          altBtnStyle = ButtonStyle.Secondary; // Gray
          altBtnDisabled = false;
        } else if (isAlt) {
          mainBtnStyle = ButtonStyle.Secondary; // Gray
          mainBtnDisabled = false;
          altBtnStyle = ButtonStyle.Primary; // Blue
          altBtnDisabled = true;
        }

        const mainCustomId = isManagingSelf
          ? `accountmanager:main:${acc.id}`
          : `staffaccountmanager:main:${discordId}:${acc.id}`;
        const altCustomId = isManagingSelf
          ? `accountmanager:alt:${acc.id}`
          : `staffaccountmanager:alt:${discordId}:${acc.id}`;
        const deleteCustomId = isManagingSelf
          ? `accountmanager:delete:${acc.id}`
          : `staffaccountmanager:delete:${discordId}:${acc.id}`;

        container.addActionRowComponents(
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
              .setStyle(mainBtnStyle)
              .setLabel("Main")
              .setDisabled(mainBtnDisabled)
              .setCustomId(mainCustomId),
            new ButtonBuilder()
              .setStyle(altBtnStyle)
              .setLabel("Alt")
              .setDisabled(altBtnDisabled)
              .setCustomId(altCustomId),
            new ButtonBuilder()
              .setStyle(ButtonStyle.Danger)
              .setLabel("Unlink (Delete)")
              .setCustomId(deleteCustomId),
          ),
        );
      }
    }

    // Show unverified accounts
    if (unverifiedAccounts.length > 0) {
      if (verifiedAccounts.length > 0) {
        container.addSeparatorComponents(
          new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true),
        );
      }

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "**⚠️ Unverified Accounts (Whitelist Access Only)**",
        ),
      );

      for (const acc of unverifiedAccounts) {
        const profileLink = `<https://vrchat.com/home/user/${acc.vrcUserId}>`;
        const displayName = acc.vrchatUsername || acc.vrcUserId;
        const discordPing = `<@${discordId}>`;

        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `[${displayName}](${profileLink}) - **Can be taken over** - Linked to ${discordPing}`,
          ),
        );

        // Only show delete button for unverified accounts
        container.addActionRowComponents(
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
              .setStyle(ButtonStyle.Secondary)
              .setLabel("Main")
              .setDisabled(true)
              .setCustomId(`disabled:main:${acc.id}`),
            new ButtonBuilder()
              .setStyle(ButtonStyle.Secondary)
              .setLabel("Alt")
              .setDisabled(true)
              .setCustomId(`disabled:alt:${acc.id}`),
            new ButtonBuilder()
              .setStyle(ButtonStyle.Danger)
              .setLabel("Unlink (Delete)")
              .setCustomId(
                isManagingSelf
                  ? `accountmanager:delete:${acc.id}`
                  : `staffaccountmanager:delete:${discordId}:${acc.id}`,
              ),
          ),
        );
      }
    }

    await interaction.reply({
      components: [container],
      flags: [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2],
    });
  }
}
