import {
  ButtonInteraction,
  MessageFlags,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { Discord, ButtonComponent, Guard } from "discordx";
import { StaffGuard } from "../../../../utility/guards.js";
import { loaManager, patrolTimer, prisma } from "../../../../main.js";
import { formatDuration } from "../../../../utility/timeParser.js";
import { loggers } from "../../../../utility/logger.js";

@Discord()
export class LOAButtonHandlers {
  @ButtonComponent({ id: /^loa:approve:(\d+)$/ })
  @Guard(StaffGuard)
  async handleApprove(interaction: ButtonInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Defer immediately to avoid timeout
    await interaction.deferUpdate();

    const loaId = parseInt(interaction.customId.split(":")[2], 10);

    try {
      const result = await loaManager.approveLOA(loaId, interaction.user.id);

      if (!result.success) {
        await interaction.followUp({
          content: `❌ Failed to approve LOA: ${result.error}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Get updated LOA for embed
      const loa = await prisma.leaveOfAbsence.findUnique({
        where: { id: loaId },
        include: { user: true },
      });

      if (!loa) {
        await interaction.followUp({
          content: "❌ LOA not found after approval.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Update embed
      const embed = new EmbedBuilder()
        .setTitle("Leave of Absence Request")
        .setDescription(`**User:** <@${loa.user.discordId}>\n**Status:** ${loa.status === "ACTIVE" ? "✅ Active" : "✅ Approved"}`)
        .addFields(
          {
            name: "Duration",
            value: formatDuration(loa.endDate.getTime() - loa.startDate.getTime()),
            inline: true,
          },
          {
            name: "Start Date",
            value: `<t:${Math.floor(loa.startDate.getTime() / 1000)}:F>`,
            inline: true,
          },
          {
            name: "End Date",
            value: `<t:${Math.floor(loa.endDate.getTime() / 1000)}:F>`,
            inline: true,
          },
          {
            name: "Reason",
            value: loa.reason,
          },
          {
            name: "Approved By",
            value: `<@${loa.approvedBy}>`,
            inline: true,
          },
        )
        .setColor(Colors.Green)
        .setTimestamp();

      // Add "End Early" button if active
      const components: ActionRowBuilder<ButtonBuilder>[] = [];
      if (loa.status === "ACTIVE") {
        const endEarlyButton = new ButtonBuilder()
          .setCustomId(`loa:end-early:${loa.id}`)
          .setLabel("End Early")
          .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(endEarlyButton);
        components.push(row);
      }

      await interaction.editReply({
        embeds: [embed],
        components,
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "loa-approved",
        interaction.user.id,
        loa.user.discordId,
        `LOA id ${loaId}. ${loa.status === "ACTIVE" ? "Active" : "Approved"}. Duration: ${formatDuration(loa.endDate.getTime() - loa.startDate.getTime())}`,
      );

      // Notify user
      try {
        const user = await interaction.client.users.fetch(loa.user.discordId);
        await user.send({
          content: `✅ Your LOA request has been approved! Your LOA is now ${loa.status === "ACTIVE" ? "active" : "scheduled to start"}.\n\n**Duration:** ${formatDuration(loa.endDate.getTime() - loa.startDate.getTime())}\n**End Date:** <t:${Math.floor(loa.endDate.getTime() / 1000)}:F>`,
        });
      } catch (_error) {
        loggers.bot.debug(`Could not DM user ${loa.user.discordId} about LOA approval`);
      }
    } catch (error) {
      loggers.bot.error("Error approving LOA", error);
      await interaction.followUp({
        content: "❌ An error occurred while approving the LOA.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ButtonComponent({ id: /^loa:deny:(\d+)$/ })
  @Guard(StaffGuard)
  async handleDeny(interaction: ButtonInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Defer immediately to avoid timeout
    await interaction.deferUpdate();

    const loaId = parseInt(interaction.customId.split(":")[2], 10);

    try {
      // Deny without reason for now (can be enhanced later with modals)
      const result = await loaManager.denyLOA(loaId, interaction.user.id);

      if (!result.success) {
        await interaction.followUp({
          content: `❌ Failed to deny LOA: ${result.error}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Get updated LOA for embed
      const loa = await prisma.leaveOfAbsence.findUnique({
        where: { id: loaId },
        include: { user: true },
      });

      if (!loa) {
        await interaction.followUp({
          content: "❌ LOA not found after denial.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Update original message
      const embed = new EmbedBuilder()
        .setTitle("Leave of Absence Request")
        .setDescription(`**User:** <@${loa.user.discordId}>\n**Status:** ❌ Denied`)
        .addFields(
          {
            name: "Duration",
            value: formatDuration(loa.endDate.getTime() - loa.startDate.getTime()),
            inline: true,
          },
          {
            name: "Start Date",
            value: `<t:${Math.floor(loa.startDate.getTime() / 1000)}:F>`,
            inline: true,
          },
          {
            name: "End Date",
            value: `<t:${Math.floor(loa.endDate.getTime() / 1000)}:F>`,
            inline: true,
          },
          {
            name: "Reason",
            value: loa.reason,
          },
          {
            name: "Denied By",
            value: `<@${loa.deniedBy}>`,
            inline: true,
          },
        )
        .setColor(Colors.Red)
        .setTimestamp();

      if (loa.denialReason) {
        embed.addFields({
          name: "Denial Reason",
          value: loa.denialReason,
        });
      }

      await interaction.editReply({
        embeds: [embed],
        components: [],
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "loa-denied",
        interaction.user.id,
        loa.user.discordId,
        `LOA id ${loaId}.${loa.denialReason ? ` Reason: ${loa.denialReason}` : ""}`,
      );

      // Notify user
      try {
        const user = await interaction.client.users.fetch(loa.user.discordId);
        await user.send({
          content: `❌ Your LOA request has been denied.${loa.denialReason ? `\n\n**Reason:** ${loa.denialReason}` : ""}`,
        });
      } catch (_error) {
        loggers.bot.debug(`Could not DM user ${loa.user.discordId} about LOA denial`);
      }
    } catch (error) {
      loggers.bot.error("Error denying LOA", error);
      await interaction.followUp({
        content: "❌ An error occurred while denying the LOA.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ButtonComponent({ id: /^loa:end-early:(\d+)(?::(\d+))?(?::(confirm|cancel))?$/ })
  async handleEndEarly(interaction: ButtonInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const parts = interaction.customId.split(":");
    const loaId = parseInt(parts[2], 10);
    const originalMessageId = parts[3]; // Message ID of the original LOA message (if present)
    const action = parts[4]; // "confirm", "cancel", or undefined
    
    // If this is the initial button press (not confirmation), store the original message ID
    const currentOriginalMessageId = action === undefined ? interaction.message.id : originalMessageId;

    // Authorization check: verify user owns the LOA or has staff permissions
    try {
      const loa = await prisma.leaveOfAbsence.findUnique({
        where: { id: loaId },
        include: { user: true },
      });

      if (!loa) {
        await interaction.reply({
          content: "❌ LOA not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const isOwner = loa.user.discordId === interaction.user.id;
      
      // Only owners can end their LOA early (staff bypass removed to prevent confirm dialog for non-owners)
      if (!isOwner) {
        await interaction.reply({
          content: "❌ Only the LOA owner can end their LOA early.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } catch (error) {
      loggers.bot.error("Error checking LOA authorization", error);
      await interaction.reply({
        content: "❌ An error occurred while checking permissions.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Handle cancel action
    if (action === "cancel") {
      await interaction.update({
        content: "❌ Cancelled ending LOA early.",
        components: [],
        embeds: [],
      });
      return;
    }

    // Handle confirm action
    if (action === "confirm") {
      try {
        const result = await loaManager.endEarly(loaId, interaction.user.id);

        if (!result.success) {
          await interaction.update({
            content: `❌ Failed to end LOA: ${result.error}`,
            components: [],
            embeds: [],
          });
          return;
        }

        // Get updated LOA
        const loa = await prisma.leaveOfAbsence.findUnique({
          where: { id: loaId },
          include: { user: true },
        });

        if (!loa) {
          await interaction.update({
            content: "❌ LOA not found after ending.",
            components: [],
            embeds: [],
          });
          return;
        }

        // Update the original LOA request message (not the ephemeral confirmation)
        try {
          const channel = interaction.channel;
          if (channel && channel.isTextBased() && !channel.isDMBased() && currentOriginalMessageId) {
            // Fetch the original message using the stored message ID
            const originalMessage = await channel.messages.fetch(currentOriginalMessageId);
            
            if (originalMessage) {
              const embed = new EmbedBuilder()
                .setTitle("Leave of Absence Request")
                .setDescription(`**User:** <@${loa.user.discordId}>\n**Status:** ⚠️ Ended Early`)
                .addFields(
                  {
                    name: "Duration",
                    value: formatDuration(loa.endDate.getTime() - loa.startDate.getTime()),
                    inline: true,
                  },
                  {
                    name: "Ended Early At",
                    value: loa.endedEarlyAt ? `<t:${Math.floor(loa.endedEarlyAt.getTime() / 1000)}:F>` : "N/A",
                    inline: true,
                  },
                  {
                    name: "Cooldown Until",
                    value: loa.cooldownEndDate ? `<t:${Math.floor(loa.cooldownEndDate.getTime() / 1000)}:F>` : "N/A",
                    inline: true,
                  },
                  {
                    name: "Reason",
                    value: loa.reason,
                  },
                )
                .setColor(Colors.Orange)
                .setTimestamp();

              await originalMessage.edit({
                embeds: [embed],
                components: [],
              });
            }
          }
        } catch (error) {
          loggers.bot.debug("Could not update original LOA message", error);
        }

        if (interaction.guildId) {
          await patrolTimer.logCommandUsage(
            interaction.guildId,
            "loa-ended-early",
            interaction.user.id,
            loa.user.discordId,
            `LOA id ${loaId}`,
          );
        }

        const cooldownEnd = loa.cooldownEndDate
          ? `<t:${Math.floor(loa.cooldownEndDate.getTime() / 1000)}:F>`
          : "N/A";
        await interaction.update({
          content: `✅ Your LOA has been ended early. You are now in a cooldown period until ${cooldownEnd}. You cannot request a new LOA until then.`,
          components: [],
          embeds: [],
        });
      } catch (error) {
        loggers.bot.error("Error ending LOA early", error);
        await interaction.update({
          content: "❌ An error occurred while ending the LOA.",
          components: [],
          embeds: [],
        });
      }
      return;
    }

    // No explicit action (initial button press) - show confirmation dialog
    // Include the original message ID in the button custom IDs so we can edit it later
    const embed = new EmbedBuilder()
      .setTitle("⚠️ End LOA Early?")
      .setDescription(
        "Are you sure you want to end your LOA early?\n\n**Warning:** You will be in a 2-week cooldown period and cannot request a new LOA until it expires.",
      )
      .setColor(Colors.Orange);

    const confirmButton = new ButtonBuilder()
      .setCustomId(`loa:end-early:${loaId}:${currentOriginalMessageId}:confirm`)
      .setLabel("Yes, End Early")
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId(`loa:end-early:${loaId}:${currentOriginalMessageId}:cancel`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

    await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  }
}
