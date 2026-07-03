import { ButtonComponent, Discord, Guard } from "discordx";
import { ButtonInteraction, GuildMember, MessageFlags } from "discord.js";
import { patrolTimer } from "../../../../main.js";
import { hasNode, PermissionNodeGuard } from "../../../../utility/permissionNodes.js";

@Discord()
export class PatrolButtonHandlers {
  @ButtonComponent({ id: /patrol-wipe-confirm:(\d+):(true|false)/ })
  @Guard(PermissionNodeGuard("patrol.manage.wipe"))
  async handleWipeConfirm(interaction: ButtonInteraction) {
    if (!interaction.guildId) {return;}    
    const [, userId] = interaction.customId.split(":");
    
    const member = interaction.member as GuildMember;
    if (!(await hasNode(member, "patrol.manage.wipe"))) {
      await interaction.reply({
        content: "❌ You don't have permission to wipe patrol data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    
    await patrolTimer.reset(interaction.guildId, userId);
    
    await patrolTimer.logCommandUsage(interaction.guildId, "wipe", interaction.user.id, userId);

    await interaction.update({
      content: `✅ Successfully wiped all patrol data for <@${userId}>.`,
      components: [],
    });
  }

  @ButtonComponent({ id: /patrol-wipe-cancel:(\d+)/ })
  async handleWipeCancel(interaction: ButtonInteraction) {
    const [, userId] = interaction.customId.split(":");
    
    await interaction.update({
      content: `❌ Cancelled wipe operation for <@${userId}>.`,
      components: [],
    });
  }
}
