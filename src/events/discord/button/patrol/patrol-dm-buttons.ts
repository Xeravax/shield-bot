import { ButtonComponent, Discord } from "discordx";
import { ButtonInteraction, MessageFlags, EmbedBuilder, Colors, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { prisma } from "../../../../main.js";
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

      // Get or create user
      let user = await prisma.user.findUnique({
        where: { discordId: userId },
        include: { userPreferences: true },
      });

      if (!user) {
        // Create user if doesn't exist
        user = await prisma.user.create({
          data: { discordId: userId },
          include: { userPreferences: true },
        });
      }

      // Update or create preferences
      if (user.userPreferences) {
        await prisma.userPreferences.update({
          where: { userId: user.id },
          data: { patrolDmDisabled: true },
        });
      } else {
        await prisma.userPreferences.create({
          data: {
            userId: user.id,
            patrolDmDisabled: true,
          },
        });
      }

      // Update the message with confirmation and enable button
      const embed = new EmbedBuilder()
        .setTitle("✅ Patrol DM Disabled")
        .setDescription("You will no longer receive DM notifications when you complete patrol sessions.\n\nYou can re-enable them at any time using the button below.")
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
      }).catch(() => {
        // If update already happened, ignore
      });
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

      // Get user
      const user = await prisma.user.findUnique({
        where: { discordId: userId },
        include: { userPreferences: true },
      });

      if (!user) {
        await interaction.reply({
          content: "❌ User not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Update or create preferences
      if (user.userPreferences) {
        await prisma.userPreferences.update({
          where: { userId: user.id },
          data: { patrolDmDisabled: false },
        });
      } else {
        await prisma.userPreferences.create({
          data: {
            userId: user.id,
            patrolDmDisabled: false,
          },
        });
      }

      // Update the message with confirmation and disable button
      const embed = new EmbedBuilder()
        .setTitle("✅ Patrol DM Enabled")
        .setDescription("You will now receive DM notifications when you complete patrol sessions.\n\nYou can disable them at any time using the button below.")
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
      }).catch(() => {
        // If update already happened, ignore
      });
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

      let user = await prisma.user.findUnique({
        where: { discordId: userId },
        include: { userPreferences: true },
      });

      if (!user) {
        user = await prisma.user.create({
          data: { discordId: userId },
          include: { userPreferences: true },
        });
      }

      if (user.userPreferences) {
        await prisma.userPreferences.update({
          where: { userId: user.id },
          data: { patrolNoShieldMemberDmDisabled: true },
        });
      } else {
        await prisma.userPreferences.create({
          data: {
            userId: user.id,
            patrolNoShieldMemberDmDisabled: true,
          },
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("Reminders turned off")
        .setDescription(
          "You will no longer be DM'd when you join a patrol channel without the Shield Member role.\n\nPatrol hours still only count once you have the Shield Member role. Completion DMs after patrol sessions are controlled separately.",
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
