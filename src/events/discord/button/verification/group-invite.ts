import {
  ButtonInteraction,
  MessageFlags,
  EmbedBuilder,
  Colors,
} from "discord.js";
import { Discord, ButtonComponent } from "discordx";
import { inviteUserToGroup } from "../../../../utility/vrchat/groups.js";
import { loggers } from "../../../../utility/logger.js";
import { requireVerifiedAccounts } from "../../../../utility/verification/requireVerifiedAccount.js";
import { requireGuildVrcGroupId } from "../../../../utility/group/guildGroupConfig.js";

@Discord()
export class VRChatGroupInviteButtonHandler {
  @ButtonComponent({ id: /grp-inv:(\d+):([a-zA-Z0-9\-_]+)/ })
  async handleGroupInvite(interaction: ButtonInteraction) {
    const match = interaction.customId.match(
      /^grp-inv:(\d+):([a-zA-Z0-9\-_]+)$/,
    );
    const discordId = match?.[1];
    const vrcUserId = match?.[2];

    if (!discordId || !vrcUserId) {
      await interaction.reply({
        content: "❌ Invalid invite button.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== discordId) {
      await interaction.reply({
        content: "❌ This button is not for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let vrcAccount;
    let groupId: string;
    try {
      const accountsResult = await requireVerifiedAccounts(discordId);
      if (!accountsResult.ok) {
        await interaction.editReply({
          content:
            "❌ VRChat account not found or not verified. Please verify your account first using `/verify account`.",
        });
        return;
      }

      vrcAccount = accountsResult.value.find(
        (account) => account.vrcUserId === vrcUserId,
      );
      if (!vrcAccount) {
        await interaction.editReply({
          content:
            "❌ VRChat account not found or not verified. Please verify your account first using `/verify account`.",
        });
        return;
      }

      const groupResult = await requireGuildVrcGroupId(interaction.guildId);
      if (!groupResult.ok) {
        await interaction.editReply({
          content: groupResult.message,
        });
        return;
      }
      groupId = groupResult.value;
    } catch (error: unknown) {
      loggers.vrchat.error("Error validating group invite prerequisites", error);
      await interaction.editReply({
        content:
          "❌ Failed to validate your account or group settings. Please try again later.",
      });
      return;
    }

    try {
      const result = await inviteUserToGroup(groupId, vrcUserId);

      if (result && typeof result === "object" && "alreadyMember" in result && result.alreadyMember) {
        const embed = new EmbedBuilder()
          .setTitle("ℹ️ Already a Member")
          .setDescription(
            `You are already a member of the VRChat group!\n\n**Account:** ${vrcAccount.vrchatUsername || vrcUserId}`,
          )
          .setColor(Colors.Blue)
          .setFooter({ text: "S.H.I.E.L.D. Bot - Group Management" })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("✅ Group Invite Sent!")
        .setDescription(
          `A group invite has been sent to your VRChat account!\n\n**Account:** ${vrcAccount.vrchatUsername || vrcUserId}\n\nCheck your VRChat notifications to accept the invite.`,
        )
        .setColor(Colors.Green)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Management" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error: unknown) {
      loggers.vrchat.error("Error sending group invite", error);

      let errorMessage = "Failed to send group invite. Please try again later.";
      if (error instanceof Error && error.message?.includes("400")) {
        errorMessage =
          "You may already be in the group, have a pending invite, or the group settings don't allow invites.";
      } else if (error instanceof Error && error.message?.includes("404")) {
        errorMessage = "The VRChat group was not found.";
      }

      const embed = new EmbedBuilder()
        .setTitle("❌ Group Invite Failed")
        .setDescription(errorMessage)
        .setColor(Colors.Red)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Management" });

      await interaction.editReply({ embeds: [embed] });
    }
  }
}
