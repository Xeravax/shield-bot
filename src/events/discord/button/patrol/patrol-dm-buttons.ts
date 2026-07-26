import { ButtonComponent, Discord } from "discordx";
import { ButtonInteraction, MessageFlags, EmbedBuilder, Colors, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { updateUserPreferences } from "../../../../utility/userPreferences.js";
import { loggers } from "../../../../utility/logger.js";

@Discord()
export class PatrolDmButtonHandlers {
  @ButtonComponent({ id: /^patrol-dm-disable:(\d+)$/ })
  async handleDisableDm(interaction: ButtonInteraction) {
    try {
      const parts = interaction.customId.split(":");
      const userId = parts[1];

      if (!userId || interaction.user.id !== userId) {
        await interaction.reply({
          content: "❌ This button is not for you.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await updateUserPreferences(userId, { patrolDmDisabled: true });

      const embed = new EmbedBuilder()
        .setTitle("✅ Patrol DM Disabled")
        .setDescription(
          "You will no longer receive DM notifications when you complete patrol sessions.\n\n" +
          "You can re-enable them via the button below or `/profile settings`.",
        )
        .setColor(Colors.Orange)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Patrol System" })
        .setTimestamp();

      const enableButton = new ButtonBuilder()
        .setCustomId(`patrol-dm-enable:${userId}`)
        .setLabel("Enable Patrol DM")
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(enableButton);

      await interaction.update({
        embeds: [embed],
        components: [row],
      });

      loggers.patrol.info(`User ${userId} disabled patrol DMs`);
    } catch (error) {
      loggers.patrol.error("Error in handleDisableDm", error);
      await interaction.reply({
        content: "❌ An error occurred while processing your request.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  }

  @ButtonComponent({ id: /^patrol-dm-enable:(\d+)$/ })
  async handleEnableDm(interaction: ButtonInteraction) {
    try {
      const parts = interaction.customId.split(":");
      const userId = parts[1];

      if (!userId || interaction.user.id !== userId) {
        await interaction.reply({
          content: "❌ This button is not for you.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await updateUserPreferences(userId, { patrolDmDisabled: false });

      const embed = new EmbedBuilder()
        .setTitle("✅ Patrol DM Enabled")
        .setDescription(
          "You will now receive DM notifications when you complete patrol sessions.\n\n" +
          "You can disable them via the button below or `/profile settings`.",
        )
        .setColor(Colors.Green)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Patrol System" })
        .setTimestamp();

      const disableButton = new ButtonBuilder()
        .setCustomId(`patrol-dm-disable:${userId}`)
        .setLabel("Disable Patrol DM")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(disableButton);

      await interaction.update({
        embeds: [embed],
        components: [row],
      });

      loggers.patrol.info(`User ${userId} enabled patrol DMs`);
    } catch (error) {
      loggers.patrol.error("Error in handleEnableDm", error);
      await interaction.reply({
        content: "❌ An error occurred while processing your request.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  }

  @ButtonComponent({ id: /^patrol-no-shield-member-dm-ignore:(\d+)$/ })
  async handleIgnoreNoShieldMemberDm(interaction: ButtonInteraction) {
    try {
      const parts = interaction.customId.split(":");
      const userId = parts[1];

      if (!userId || interaction.user.id !== userId) {
        await interaction.reply({
          content: "❌ This button is not for you.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await updateUserPreferences(userId, { patrolNoShieldMemberDmDisabled: true });

      const embed = new EmbedBuilder()
        .setTitle("Reminders turned off")
        .setDescription(
          "You will no longer be DM'd when you join a patrol channel without the Shield Member role.\n\n" +
          "Patrol hours still only count once you have the Shield Member role. " +
          "Manage all preferences with `/profile settings`.",
        )
        .setColor(Colors.Grey)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Patrol System" })
        .setTimestamp();

      await interaction.update({
        embeds: [embed],
        components: [],
      });

      loggers.patrol.info(
        `User ${userId} disabled no-Shield-Member patrol join DMs`,
      );
    } catch (error) {
      loggers.patrol.error("Error in handleIgnoreNoShieldMemberDm", error);
      await interaction
        .reply({
          content: "❌ An error occurred while processing your request.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
  }
}
