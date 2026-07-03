import { ButtonComponent, Discord } from "discordx";
import { ButtonInteraction, MessageFlags } from "discord.js";
import { patrolTimer } from "../../../../main.js";
import { hasNode } from "../../../../utility/permissionNodes.js";
import { matchComponentId } from "../../../../utility/componentId.js";
import { resolveGuildMember } from "../../../../utility/guards.js";

@Discord()
export class PatrolButtonHandlers {
  @ButtonComponent({ id: /patrol-wipe-confirm:(\d+):(true|false)/ })
  async handleWipeConfirm(interaction: ButtonInteraction) {
    if (!interaction.guildId) {return;}
    await interaction.deferUpdate();

    const match = matchComponentId(interaction.customId, /^patrol-wipe-confirm:(\d+):(true|false)$/);
    if (!match) {
      await interaction.followUp({
        content: "❌ Invalid button data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const userId = match[1];

    const member = await resolveGuildMember(interaction);
    if (!member || !(await hasNode(member, "patrol.manage.wipe"))) {
      await interaction.followUp({
        content: "❌ You don't have permission to wipe patrol data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await patrolTimer.reset(interaction.guildId, userId);

    await patrolTimer.logCommandUsage(interaction.guildId, "wipe", interaction.user.id, userId);

    await interaction.editReply({
      content: `✅ Successfully wiped all patrol data for <@${userId}>.`,
      components: [],
    });
  }

  @ButtonComponent({ id: /patrol-wipe-cancel:(\d+)/ })
  async handleWipeCancel(interaction: ButtonInteraction) {
    const match = matchComponentId(interaction.customId, /^patrol-wipe-cancel:(\d+)$/);
    if (!match) {
      await interaction.reply({
        content: "❌ Invalid button data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const userId = match[1];

    await interaction.update({
      content: `❌ Cancelled wipe operation for <@${userId}>.`,
      components: [],
    });
  }
}
