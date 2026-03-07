import {
  ButtonInteraction,
  MessageFlags,
  EmbedBuilder,
  Colors,
} from "discord.js";
import { Discord, ButtonComponent, Guard } from "discordx";
import { StaffGuard } from "../../../../utility/guards.js";
import { prisma, patrolTimer } from "../../../../main.js";
import { loggers } from "../../../../utility/logger.js";

/** Parse patrol-promo:action:guildId:userId:currentRankRoleId:nextRankRoleId */
function parseCustomId(customId: string): { guildId: string; userId: string; currentRankRoleId: string; nextRankRoleId: string } | null {
  const parts = customId.split(":");
  if (parts.length < 6) {
    return null;
  }
  return {
    guildId: parts[2],
    userId: parts[3],
    currentRankRoleId: parts[4],
    nextRankRoleId: parts[5],
  };
}

/** Strip to only A-z and . so role names can't inject formatting. */
function scrubRoleDisplay(name: string): string {
  return name.replace(/[^a-zA-Z.]/g, "") || name;
}

@Discord()
export class PatrolPromotionButtonHandlers {
  @ButtonComponent({ id: /^patrol-promo:approve:/ })
  @Guard(StaffGuard)
  async handleApprove(interaction: ButtonInteraction) {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    const parsed = parseCustomId(interaction.customId);
    if (!parsed) {
      await interaction.followUp({
        content: "❌ Invalid button data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { guildId, userId, currentRankRoleId, nextRankRoleId } = parsed;
    const messageId = interaction.message.id;

    try {
      const notification = await prisma.voicePatrolPromotionNotification.findFirst({
        where: {
          guildId,
          userId,
          nextRankRoleId,
          messageId,
          status: "PENDING",
        },
      });

      if (!notification) {
        await interaction.followUp({
          content: "❌ Already handled or invalid promotion message.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const now = new Date();
      await prisma.voicePatrolPromotionNotification.update({
        where: { id: notification.id },
        data: { status: "APPROVED", resolvedAt: now, resolvedBy: interaction.user.id },
      });

      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!member) {
        await interaction.followUp({
          content: "❌ User not found in this server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      try {
        await member.roles.add(nextRankRoleId);
      } catch (err) {
        loggers.patrol.error("Failed to add promotion role", err);
        await interaction.followUp({
          content: `❌ Failed to add role (permission or role hierarchy).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.voicePatrolRoleObtainedAt.upsert({
        where: {
          guildId_userId_roleId: { guildId, userId, roleId: nextRankRoleId },
        },
        update: { obtainedAt: now },
        create: { guildId, userId, roleId: nextRankRoleId, obtainedAt: now },
      });

      const currentRankName = scrubRoleDisplay(interaction.guild.roles.cache.get(currentRankRoleId)?.name ?? "Current");
      const nextRankName = scrubRoleDisplay(interaction.guild.roles.cache.get(nextRankRoleId)?.name ?? "Next");
      const totalHours = notification.totalHoursAtNotify ?? 0;

      const resolvedEmbed = new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle("Patrol promotion – promoted")
        .setDescription(`✅ A member has been promoted.`)
        .addFields(
          { name: "User", value: `${member.user.tag} (\`${userId}\`)`, inline: false },
          { name: "Promotion", value: `**${currentRankName}** → **${nextRankName}**`, inline: true },
          { name: "Approved by", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Total patrol hours at notify", value: `${totalHours.toFixed(1)}h`, inline: false },
        )
        .setTimestamp();

      await interaction.editReply({
        content: "",
        embeds: [resolvedEmbed],
        components: [],
      });

      const settings = await patrolTimer.getSettings(guildId);
      if (settings.toPromoteChannelId) {
        const toPromoteChannel = await interaction.guild.channels.fetch(settings.toPromoteChannelId).catch(() => null);
        if (toPromoteChannel?.isTextBased() && "send" in toPromoteChannel) {
          const toPromoteEmbed = new EmbedBuilder()
            .setColor(Colors.Green)
            .setTitle("Patrol promotion – approved")
            .setDescription(`✅ A member has been approved for promotion.`)
            .addFields(
              { name: "User", value: `${member.user.tag} (\`${userId}\`)`, inline: false },
              { name: "Promotion", value: `**${currentRankName}** → **${nextRankName}**`, inline: true },
              { name: "Approved by", value: `<@${interaction.user.id}>`, inline: true },
              { name: "Total patrol hours at notify", value: `${totalHours.toFixed(1)}h`, inline: false },
            )
            .setTimestamp();
          await toPromoteChannel.send({
            embeds: [toPromoteEmbed],
            allowedMentions: { users: [] },
          });
        }
      }

      await interaction.followUp({
        content: "✅ Promotion approved.",
        flags: MessageFlags.Ephemeral,
      });

      loggers.patrol.info(`Promotion approved for ${member.user.tag}: ${currentRankName} → ${nextRankName} by ${interaction.user.tag}`);
    } catch (err) {
      loggers.patrol.error("Promotion approve error", err);
      await interaction.followUp({
        content: "❌ An error occurred while approving.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ButtonComponent({ id: /^patrol-promo:deny:/ })
  @Guard(StaffGuard)
  async handleDeny(interaction: ButtonInteraction) {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    const parsed = parseCustomId(interaction.customId);
    if (!parsed) {
      await interaction.followUp({
        content: "❌ Invalid button data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { guildId, userId, currentRankRoleId, nextRankRoleId } = parsed;
    const messageId = interaction.message.id;

    try {
      const notification = await prisma.voicePatrolPromotionNotification.findFirst({
        where: {
          guildId,
          userId,
          nextRankRoleId,
          messageId,
          status: "PENDING",
        },
      });

      if (!notification) {
        await interaction.followUp({
          content: "❌ Already handled or invalid promotion message.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const now = new Date();
      await prisma.voicePatrolPromotionNotification.update({
        where: { id: notification.id },
        data: { status: "DENIED", resolvedAt: now, resolvedBy: interaction.user.id },
      });

      await prisma.voicePatrolRoleObtainedAt.upsert({
        where: {
          guildId_userId_roleId: { guildId, userId, roleId: currentRankRoleId },
        },
        update: { obtainedAt: now },
        create: { guildId, userId, roleId: currentRankRoleId, obtainedAt: now },
      });

      await prisma.voicePatrolPromotionNotification.delete({
        where: { id: notification.id },
      });

      const currentRankName = scrubRoleDisplay(interaction.guild.roles.cache.get(currentRankRoleId)?.name ?? "Current");
      const nextRankName = scrubRoleDisplay(interaction.guild.roles.cache.get(nextRankRoleId)?.name ?? "Next");

      const resolvedEmbed = new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle("Patrol promotion – denied")
        .setDescription(`❌ Not promoted. Cooldown reset; they can be considered again after cooldown.`)
        .addFields(
          { name: "User", value: `\`${userId}\``, inline: false },
          { name: "Promotion", value: `**${currentRankName}** → **${nextRankName}**`, inline: true },
          { name: "Denied by", value: `<@${interaction.user.id}>`, inline: true },
        )
        .setTimestamp();

      await interaction.editReply({
        content: "",
        embeds: [resolvedEmbed],
        components: [],
      });

      await interaction.followUp({
        content: "❌ Promotion denied.",
        flags: MessageFlags.Ephemeral,
      });

      loggers.patrol.info(`Promotion denied for user ${userId}: ${currentRankName} → ${nextRankName} by ${interaction.user.tag}; cooldown reset`);
    } catch (err) {
      loggers.patrol.error("Promotion deny error", err);
      await interaction.followUp({
        content: "❌ An error occurred while denying.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
