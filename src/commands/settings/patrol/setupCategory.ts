import { Discord, Guard, Slash, SlashGroup } from "discordx";
import {
  CommandInteraction,
  MessageFlags,
  GuildMember,
} from "discord.js";
import { patrolTimer } from "../../../main.js";
import { StaffGuard } from "../../../utility/guards.js";

@Discord()
@SlashGroup({
  description: "Patrol settings",
  name: "patrol",
  root: "settings",
})
@SlashGroup("patrol", "settings")
@Guard(StaffGuard)
export class SettingsPatrolSubGroup {
  // Additional patrol setting commands can be added here as more functionality is needed

  @Slash({
    name: "setup-category",
    description:
      "Set tracked voice category to your current voice channel's parent.",
  })
  async setupPatrolCategory(interaction: CommandInteraction) {
    if (!interaction.guildId || !interaction.guild) {return;}

    const member = interaction.member as GuildMember;
    const voice = member.voice?.channel;
    if (!voice || voice.type !== 2 || !voice.parentId) {
      await interaction.reply({
        content: "Join a voice channel inside the desired category first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await patrolTimer.setCategory(interaction.guildId, voice.parentId);
    await patrolTimer.logCommandUsage(
      interaction.guildId,
      "settings-patrol-setup-category",
      interaction.user.id,
      undefined,
      voice.parent?.name ?? voice.parentId,
    );
    await interaction.reply({
      content: `Tracked category set to: ${voice.parent?.name ?? voice.parentId}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
