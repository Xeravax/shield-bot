import {
  ButtonInteraction,
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
} from "discord.js";
import { Discord, ButtonComponent, Guard } from "discordx";
import { prisma } from "../../../../main.js";
import type { User, VRChatAccount } from "../../../../generated/prisma/client.js";
import { unfriendUser } from "../../../../utility/vrchat/user.js";
import { StaffGuard } from "../../../../utility/guards.js";
import { whitelistManager } from "../../../../managers/whitelist/whitelistManager.js";
import { sendWhitelistLog, getUserWhitelistRoles } from "../../../../utility/vrchat/whitelistLogger.js";
import { loggers } from "../../../../utility/logger.js";

@Discord()
export class VRCStaffAccountManagerButtonHandler {
  @ButtonComponent({
    id: /^staffaccountmanager:(main|alt|delete):(\d+):(\d+)$/,
  })
  @Guard(StaffGuard)
  async handleStaffAccountManager(interaction: ButtonInteraction) {
    const parts = interaction.customId.split(":");
    const action = parts[1];
    const targetDiscordId = parts[2];
    const accountIdStr = parts[3];

    if (!action || !targetDiscordId || !accountIdStr) {
      await interaction.reply({
        content: "❌ Invalid button interaction data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const accountId = parseInt(accountIdStr, 10);
      if (Number.isNaN(accountId)) {
        await interaction.reply({
          content: "❌ Invalid button interaction data.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const vrcAccount = await prisma.vRChatAccount.findUnique({
        where: { id: accountId },
        include: { user: true },
      });

      if (!vrcAccount || vrcAccount.user.discordId !== targetDiscordId) {
        await interaction.reply({
          content:
            "❌ VRChat account not found or not linked to the target user's Discord account.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { discordId: targetDiscordId },
        include: { vrchatAccounts: true },
      });
      if (!user) {
        await interaction.reply({
          content: "❌ User not found in database.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const vrcUserId = vrcAccount.vrcUserId;

      switch (action) {
        case "main":
          await this.handleSetMain(
            interaction,
            user,
            vrcAccount,
            vrcUserId,
            targetDiscordId,
            interaction.guildId,
          );
          break;
        case "alt":
          await this.handleSetAlt(
            interaction,
            vrcAccount,
            vrcUserId,
            targetDiscordId,
            interaction.guildId,
          );
          break;
        case "delete":
          await this.handleDelete(
            interaction,
            vrcAccount,
            vrcUserId,
            targetDiscordId,
            interaction.guildId,
          );
          break;
        default:
          await interaction.reply({
            content: "❌ Unknown action.",
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (_error) {
      loggers.bot.error("Error in staff account manager button handler", _error);
      await interaction.reply({
        content:
          "❌ An error occurred while processing your request. Please try again later.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async handleSetMain(
    interaction: ButtonInteraction,
    user: User & { vrchatAccounts: VRChatAccount[] },
    vrcAccount: VRChatAccount,
    vrcUserId: string,
    targetDiscordId: string,
    guildId: string,
  ) {
    // Check if user already has a MAIN account
    const currentMain = user.vrchatAccounts.find(
      (acc: { accountType: string }) => acc.accountType === "MAIN",
    );

    if (currentMain && currentMain.vrcUserId !== vrcUserId) {
      // Set the current MAIN to ALT
      await prisma.vRChatAccount.update({
        where: { id: currentMain.id },
        data: { accountType: "ALT" },
      });
    }

    // Set this account as MAIN
    await prisma.vRChatAccount.update({
      where: { id: vrcAccount.id },
      data: { accountType: "MAIN" },
    });

    // Update whitelist after status change
    try {
      await whitelistManager.syncAndPublishAfterVerification(targetDiscordId, guildId, undefined);
      
      // Send whitelist log for status change
      if (interaction.guild) {
        try {
          const targetUser = await interaction.client.users.fetch(targetDiscordId);
          const roles = await getUserWhitelistRoles(targetDiscordId, guildId);
          await sendWhitelistLog(interaction.client, interaction.guild.id, {
            discordId: targetDiscordId,
            displayName: targetUser.displayName || targetUser.username,
            vrchatUsername: vrcAccount.vrchatUsername || undefined,
            vrcUserId: vrcUserId,
            roles,
            action: "modified",
            accountType: "MAIN",
          });
        } catch (logError) {
          loggers.bot.warn(
            `Failed to send whitelist log for ${targetDiscordId}`,
            logError,
          );
        }
      }
    } catch (_error) {
      loggers.bot.error(
        `Failed to sync whitelist for ${targetDiscordId}`,
        _error,
      );
    }

    await this.updateStaffAccountManagerMessage(interaction, targetDiscordId);
  }

  private async handleSetAlt(
    interaction: ButtonInteraction,
    vrcAccount: VRChatAccount,
    vrcUserId: string,
    targetDiscordId: string,
    guildId: string,
  ) {
    // Set this account as ALT
    await prisma.vRChatAccount.update({
      where: { id: vrcAccount.id },
      data: { accountType: "ALT" },
    });

    // Update whitelist after status change
    try {
      await whitelistManager.syncAndPublishAfterVerification(targetDiscordId, guildId, undefined);
      
      // Send whitelist log for status change
      if (interaction.guild) {
        try {
          const targetUser = await interaction.client.users.fetch(targetDiscordId);
          const roles = await getUserWhitelistRoles(targetDiscordId, guildId);
          await sendWhitelistLog(interaction.client, interaction.guild.id, {
            discordId: targetDiscordId,
            displayName: targetUser.displayName || targetUser.username,
            vrchatUsername: vrcAccount.vrchatUsername || undefined,
            vrcUserId: vrcUserId,
            roles,
            action: "modified",
            accountType: "ALT",
          });
        } catch (logError) {
          loggers.bot.warn(
            `Failed to send whitelist log for ${targetDiscordId}`,
            logError,
          );
        }
      }
    } catch (_error) {
      loggers.bot.error(
        `Failed to sync whitelist for ${targetDiscordId}`,
        _error,
      );
    }

    await this.updateStaffAccountManagerMessage(interaction, targetDiscordId);
  }

  private async handleDelete(
    interaction: ButtonInteraction,
    vrcAccount: VRChatAccount,
    vrcUserId: string,
    targetDiscordId: string,
    guildId: string,
  ) {
    try {
      // Try to unfriend the user from VRChat
      try {
        await unfriendUser(vrcUserId);
      } catch (unfriendError) {
        loggers.vrchat.warn(
          `Failed to unfriend VRChat user ${vrcUserId}`,
          unfriendError,
        );
        // Continue with deletion even if unfriending fails
      }

      // Get roles and account type before whitelist update for logging
      let rolesBeforeDelete: string[] = [];
      const accountTypeBeforeDelete = vrcAccount.accountType;
      try {
        rolesBeforeDelete = await getUserWhitelistRoles(targetDiscordId, guildId);
      } catch (_error) {
        // Ignore errors when fetching roles before delete
      }

      // Delete the VRChat account from database
      await prisma.vRChatAccount.delete({
        where: { id: vrcAccount.id },
      });

      // Update whitelist after account deletion
      try {
        await whitelistManager.syncAndPublishAfterVerification(targetDiscordId, guildId, undefined);
        
        // Send whitelist log - check if user still has roles after deletion
        if (interaction.guild) {
          try {
            const rolesAfterDelete = await getUserWhitelistRoles(targetDiscordId, guildId);
            const wasActuallyRemoved = rolesAfterDelete.length === 0 && rolesBeforeDelete.length > 0;
            
            // Only log if they actually lost whitelist access or still have it with different roles
            if (wasActuallyRemoved || rolesAfterDelete.length > 0) {
              const targetUser = await interaction.client.users.fetch(targetDiscordId);
              await sendWhitelistLog(interaction.client, interaction.guild.id, {
                discordId: targetDiscordId,
                displayName: targetUser.displayName || targetUser.username,
                vrchatUsername: vrcAccount.vrchatUsername || undefined,
                vrcUserId: vrcUserId,
                roles: wasActuallyRemoved ? rolesBeforeDelete : rolesAfterDelete,
                action: wasActuallyRemoved ? "removed" : "modified",
                accountType: accountTypeBeforeDelete,
              });
            }
          } catch (logError) {
            loggers.bot.warn(
              `Failed to send whitelist log for ${targetDiscordId}`,
              logError,
            );
          }
        }
      } catch (whitelistError) {
        loggers.bot.error(
          `Failed to sync whitelist after deletion for ${targetDiscordId}`,
          whitelistError,
        );
      }

      await this.updateStaffAccountManagerMessage(interaction, targetDiscordId);
    } catch (_error) {
      loggers.bot.error("Error deleting VRChat account", _error);
      await interaction.reply({
        content:
          "❌ An error occurred while deleting the account. The account may have been partially removed.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async updateStaffAccountManagerMessage(
    interaction: ButtonInteraction,
    targetDiscordId: string,
  ) {
    // Get updated user data
    const user = await prisma.user.findUnique({
      where: { discordId: targetDiscordId },
      include: { vrchatAccounts: true },
    });

    if (!user || !user.vrchatAccounts || user.vrchatAccounts.length === 0) {
      // Create a simple container with just text for the completion message
      const emptyContainer = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "✅ All VRChat accounts have been unlinked from this user.",
        ),
      );
      await interaction.update({
        components: [emptyContainer],
        flags: [MessageFlags.IsComponentsV2],
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
      // Create a simple container with just text for the completion message
      const emptyContainer = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "✅ All VRChat accounts have been unlinked from this user.",
        ),
      );
      await interaction.update({
        components: [emptyContainer],
        flags: [MessageFlags.IsComponentsV2],
      });
      return;
    }

    // Rebuild the staff account manager interface
    const container = new ContainerBuilder();

    // Get target user info for display
    let targetUserTag = `<@${targetDiscordId}>`;
    try {
      const targetUser = await interaction.client.users.fetch(targetDiscordId);
      targetUserTag = targetUser.tag;
    } catch {
      // If we can't fetch the user, fall back to mention
    }

    container.addSectionComponents(
      new SectionBuilder()
        .setButtonAccessory(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Secondary)
            .setLabel("Info")
            .setEmoji({ name: "ℹ️" })
            .setDisabled(true)
            .setCustomId("staffaccountmanager:info"),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**Staff Account Manager** - Managing accounts for ${targetUserTag}\n- Only **verified** accounts can be set as MAIN/ALT. Unverified accounts have basic whitelist access only.\n- One MAIN account allowed. Deleting an account will unfriend it.\n- Username updates require being friended with the bot.`,
          ),
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
        const discordPing = `<@${targetDiscordId}>`;

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

        container.addActionRowComponents(
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
              .setStyle(mainBtnStyle)
              .setLabel("Main")
              .setDisabled(mainBtnDisabled)
              .setCustomId(
                `staffaccountmanager:main:${targetDiscordId}:${acc.id}`,
              ),
            new ButtonBuilder()
              .setStyle(altBtnStyle)
              .setLabel("Alt")
              .setDisabled(altBtnDisabled)
              .setCustomId(
                `staffaccountmanager:alt:${targetDiscordId}:${acc.id}`,
              ),
            new ButtonBuilder()
              .setStyle(ButtonStyle.Danger)
              .setLabel("Unlink (Delete)")
              .setCustomId(
                `staffaccountmanager:delete:${targetDiscordId}:${acc.id}`,
              ),
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
        const discordPing = `<@${targetDiscordId}>`;

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
                `staffaccountmanager:delete:${targetDiscordId}:${acc.id}`,
              ),
          ),
        );
      }
    }

    await interaction.update({
      components: [container],
    });
  }
}
