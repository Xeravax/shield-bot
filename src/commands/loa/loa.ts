import { Discord, Slash, SlashGroup, SlashOption, Guard } from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  User,
} from "discord.js";
import { GuildGuard } from "../../utility/guards.js";
import { PermissionNodeGuard } from "../../utility/guards.js";
import { loaManager, patrolTimer } from "../../main.js";
import { buildLOARequestEmbed } from "../../managers/loa/loaManager.js";

@Discord()
@SlashGroup({
  name: "loa",
  description: "Leave of Absence management commands",
})
@SlashGroup("loa")
@Guard(GuildGuard)
export class LOACommands {
  @Slash({
    name: "request",
    description: "Request a leave of absence",
  })
  async request(
    @SlashOption({
      name: "time",
      description: "Duration (e.g., '2 weeks', '14 days', '1 month')",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    time: string,
    @SlashOption({
      name: "reason",
      description: "Reason for the LOA",
      type: ApplicationCommandOptionType.String,
      required: true,
      maxLength: 1024,
    })
    reason: string,
    interaction: CommandInteraction,
  ) {
    // GuildGuard ensures guildId is present
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const guildId = interaction.guildId!;

    // Check cooldown first (fast check, can reply immediately if error)
    const cooldown = await loaManager.checkCooldown(guildId, interaction.user.id);
    if (cooldown.inCooldown && cooldown.cooldownEndDate) {
      const cooldownEnd = cooldown.cooldownEndDate.toLocaleString();
      await interaction.reply({
        content: `❌ You are in a cooldown period until ${cooldownEnd}. You cannot request a new LOA until then.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Defer interaction (without ephemeral flag so the message can be public)
    await interaction.deferReply();

    // Request LOA
    const result = await loaManager.requestLOA(
      guildId,
      interaction.user.id,
      time,
      reason,
    );

    if (!result.success) {
      await interaction.editReply({
        content: `❌ Failed to create LOA request: ${result.error}`,
      });
      return;
    }

    const loa = result.loa;

    const embed = buildLOARequestEmbed(
      { ...loa, user: { discordId: interaction.user.id } },
      "pending",
    );

    // Create buttons
    const approveButton = new ButtonBuilder()
      .setCustomId(`loa:approve:${loa.id}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success);

    const denyButton = new ButtonBuilder()
      .setCustomId(`loa:deny:${loa.id}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approveButton, denyButton);

    // Send public message (not ephemeral so staff can see it)
    const replyMessage = await interaction.editReply({
      embeds: [embed],
      components: [row],
    });

    if (interaction.channelId) {
      await loaManager.setAnnouncementMessageIds(loa.id, interaction.channelId, replyMessage.id);
    }
  }

  @Slash({
    name: "remove-cooldown",
    description: "Remove the LOA cooldown for a user (allows them to request a new LOA immediately)",
  })
  @Guard(PermissionNodeGuard("loa.command.remove-cooldown"))
  async removeCooldown(
    @SlashOption({
      name: "user",
      description: "The user whose cooldown should be removed",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    interaction: CommandInteraction,
  ) {
    // GuildGuard ensures guildId is present
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const guildId = interaction.guildId!;

    // Defer reply to avoid timeout during potentially slow operation
    await interaction.deferReply({ ephemeral: true });

    const result = await loaManager.removeCooldown(guildId, user.id);

    if (!result.success) {
      await interaction.editReply({
        content: `❌ Failed to remove cooldown: ${result.error}`,
      });
      return;
    }

    await patrolTimer.logCommandUsage(
      guildId,
      "loa-remove-cooldown",
      interaction.user.id,
      user.id,
      "User can request LOA again",
    );

    await interaction.editReply({
      content: `✅ Removed LOA cooldown for <@${user.id}>. They can now request a new LOA immediately.`,
    });
  }
}
