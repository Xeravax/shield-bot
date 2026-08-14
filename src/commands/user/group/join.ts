import { Discord, Guard, Slash, SlashGroup } from "discordx";
import {
  CommandInteraction,
  EmbedBuilder,
  Colors,
  MessageFlags,
  Client,
} from "discord.js";
import { inviteUserToGroup } from "../../../utility/vrchat/groups.js";
import { loggers } from "../../../utility/logger.js";
import {
  GuildGuard,
  VerifiedAccountGuard,
  VrchatGroupConfiguredGuard,
} from "../../../utility/guards.js";
import {
  type AppGuardData,
  requireGuardVerifiedAccount,
  requireGuardVrcGroupId,
} from "../../../utility/guardData.js";

@Discord()
@SlashGroup({ name: "group", description: "VRChat group commands" })
@SlashGroup("group")
export class GroupSelfInviteCommand {
  @Slash({
    name: "join",
    description: "Request an invite to the SHIELD VRChat group",
  })
  @Guard(GuildGuard, VerifiedAccountGuard(), VrchatGroupConfiguredGuard)
  async selfInvite(
    interaction: CommandInteraction,
    _client: Client,
    guardData: AppGuardData,
  ): Promise<void> {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const vrcGroupId = requireGuardVrcGroupId(guardData);
      const vrcAccount = requireGuardVerifiedAccount(guardData);

      const result = await inviteUserToGroup(vrcGroupId, vrcAccount.vrcUserId);

      if (result && typeof result === "object" && "alreadyMember" in result && result.alreadyMember) {
        const embed = new EmbedBuilder()
          .setTitle("ℹ️ Already a Member")
          .setDescription(
            `You are already a member of the VRChat group!\n\n**Account:** ${vrcAccount.vrchatUsername || vrcAccount.vrcUserId}`,
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
          `A group invite has been sent to your VRChat account!\n\n**Account:** ${vrcAccount.vrchatUsername || vrcAccount.vrcUserId}\n\nCheck your VRChat notifications to accept the invite.`,
        )
        .setColor(Colors.Green)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Management" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error: unknown) {
      loggers.bot.error("[Self Group Invite] Error", error);

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
