import {
  ButtonInteraction,
  MessageFlags,
  EmbedBuilder,
  Colors,
  ContainerBuilder,
  TextDisplayBuilder,
} from "discord.js";
import { Discord, ButtonComponent } from "discordx";
import { prisma, patrolTimer } from "../../../../main.js";
import { loggers } from "../../../../utility/logger.js";
import { hasNode } from "../../../../utility/permissionNodes.js";
import { resolveGuildMember } from "../../../../utility/guards.js";
import {
  buildPromotionThreadName,
  formatPromotionUserLines,
  getMainVRChatAccountInfo,
} from "../../../../utility/vrchat/promotionAccountInfo.js";
import {
  DEFAULT_DECLINED_COOLDOWN_HOURS,
  getDeclinedCooldownHours,
} from "../../../../managers/patrol/patrolTimerManager.js";

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

async function editPromotionMessage(
  interaction: ButtonInteraction,
  container: ContainerBuilder,
): Promise<void> {
  if (!interaction.message.editable) {
    throw new Error("Promotion message is not editable");
  }
  await interaction.message.edit({
    content: "",
    embeds: [],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}

@Discord()
export class PatrolPromotionButtonHandlers {
  /**
   * No @Guard on buttons — PermissionNodeGuard hits Prisma before deferUpdate and breaks
   * thread/channel component interactions. Staff is checked after deferUpdate.
   */
  @ButtonComponent({ id: /^patrol-promo:approve:/ })
  async handleApprove(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    const member = await resolveGuildMember(interaction);
    if (!member || !(await hasNode(member, "patrol.manage.promotion"))) {
      await interaction.followUp({
        content: "You don't have permission to use this. Missing node: patrol.manage.promotion",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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

      const promotedMember = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!promotedMember) {
        await interaction.followUp({
          content: "❌ User not found in this server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const currentRankName = scrubRoleDisplay(interaction.guild.roles.cache.get(currentRankRoleId)?.name ?? "Current");
      const nextRankName = scrubRoleDisplay(interaction.guild.roles.cache.get(nextRankRoleId)?.name ?? "Next");
      const totalHours = notification.totalHoursAtNotify ?? 0;
      const mainAccount = await getMainVRChatAccountInfo(userId);

      const resolvedContent = [
        "**Patrol promotion – promoted**",
        "",
        "✅ A member has been promoted.",
        "",
        ...formatPromotionUserLines(userId, promotedMember.user.tag, mainAccount),
        "",
        "**Promotion**",
        `**${currentRankName}** → **${nextRankName}**`,
        "",
        "**Approved by**",
        `<@${interaction.user.id}>`,
        "",
        "**Total patrol hours at notify**",
        `${totalHours.toFixed(1)}h`,
        "",
        `<t:${Math.floor(Date.now() / 1000)}:F>`,
      ].join("\n");
      const resolvedContainer = new ContainerBuilder()
        .setAccentColor(Colors.Green)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(resolvedContent));

      await editPromotionMessage(interaction, resolvedContainer);

      const settings = await patrolTimer.getSettings(guildId);
      if (settings.toPromoteChannelId) {
        const toPromoteChannel = await interaction.guild.channels.fetch(settings.toPromoteChannelId).catch(() => null);
        if (toPromoteChannel?.isTextBased() && "send" in toPromoteChannel) {
          const toPromoteEmbed = new EmbedBuilder()
            .setColor(Colors.Green)
            .setTitle("Patrol promotion – approved")
            .setDescription(`✅ A member has been approved for promotion.`)
            .addFields(
              {
                name: "User",
                value: `<@${userId}> — ${promotedMember.user.tag} (\`${userId}\`)`,
                inline: false,
              },
              {
                name: "VRChat (MAIN)",
                value: mainAccount
                  ? `[${mainAccount.vrchatUsername}](https://vrchat.com/home/user/${mainAccount.vrcUserId})`
                  : "_No verified MAIN account linked_",
                inline: false,
              },
              { name: "Promotion", value: `**${currentRankName}** → **${nextRankName}**`, inline: true },
              { name: "Approved by", value: `<@${interaction.user.id}>`, inline: true },
              { name: "Total patrol hours at notify", value: `${totalHours.toFixed(1)}h`, inline: false },
            )
            .setTimestamp();
          await toPromoteChannel.send({
            embeds: [toPromoteEmbed],
            allowedMentions: { users: [userId] },
          });
        }
      }

      await interaction.followUp({
        content: "✅ Promotion approved.",
        flags: MessageFlags.Ephemeral,
      });

      await patrolTimer.logCommandUsage(
        guildId,
        "promotion-approved",
        interaction.user.id,
        userId,
        `${currentRankName} → ${nextRankName}. Role added. Total hours at notify: ${totalHours.toFixed(1)}h`,
      );

      loggers.patrol.info(`Promotion approved for ${promotedMember.user.tag}: ${currentRankName} → ${nextRankName} by ${interaction.user.tag}`);
    } catch (err) {
      loggers.patrol.error("Promotion approve error", err);
      await interaction.followUp({
        content: "❌ An error occurred while approving.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ButtonComponent({ id: /^patrol-promo:deny:/ })
  async handleDeny(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    const member = await resolveGuildMember(interaction);
    if (!member || !(await hasNode(member, "patrol.manage.promotion"))) {
      await interaction.followUp({
        content: "You don't have permission to use this. Missing node: patrol.manage.promotion",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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

      const settings = await patrolTimer.getSettings(guildId);
      const rules = patrolTimer.getEffectivePromotionRules(settings);
      const rule = rules?.find(
        (r) => r.currentRankRoleId === currentRankRoleId && r.nextRankRoleId === nextRankRoleId,
      );
      const declinedHours = rule ? getDeclinedCooldownHours(rule) : DEFAULT_DECLINED_COOLDOWN_HOURS;

      const currentRankName = scrubRoleDisplay(interaction.guild.roles.cache.get(currentRankRoleId)?.name ?? "Current");
      const nextRankName = scrubRoleDisplay(interaction.guild.roles.cache.get(nextRankRoleId)?.name ?? "Next");

      const promotedMember = await interaction.guild.members.fetch(userId).catch(() => null);
      const mainAccount = await getMainVRChatAccountInfo(userId);
      const userTag = promotedMember?.user.tag ?? userId;

      const resolvedContent = [
        "**Patrol promotion – denied**",
        "",
        "❌ Not promoted. They can be considered again after the declined cooldown and once they have new patrol time.",
        "",
        ...formatPromotionUserLines(userId, userTag, mainAccount),
        "",
        "**Promotion**",
        `**${currentRankName}** → **${nextRankName}**`,
        "",
        "**Denied by**",
        `<@${interaction.user.id}>`,
        "",
        "**Declined cooldown**",
        `${declinedHours}h before re-suggestion for this rank`,
        "",
        `<t:${Math.floor(Date.now() / 1000)}:F>`,
      ].join("\n");
      const resolvedContainer = new ContainerBuilder()
        .setAccentColor(Colors.Red)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(resolvedContent));

      await editPromotionMessage(interaction, resolvedContainer);

      await interaction.followUp({
        content: "❌ Promotion denied.",
        flags: MessageFlags.Ephemeral,
      });

      await patrolTimer.logCommandUsage(
        guildId,
        "promotion-denied",
        interaction.user.id,
        userId,
        `${currentRankName} → ${nextRankName}. Declined cooldown: ${declinedHours}h.`,
      );

      loggers.patrol.info(`Promotion denied for user ${userId}: ${currentRankName} → ${nextRankName} by ${interaction.user.tag}; cooldown reset`);
    } catch (err) {
      loggers.patrol.error("Promotion deny error", err);
      await interaction.followUp({
        content: "❌ An error occurred while denying.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ButtonComponent({ id: /^patrol-promo:thread:/ })
  async handleThread(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = await resolveGuildMember(interaction);
    if (!member || !(await hasNode(member, "patrol.manage.promotion"))) {
      await interaction.editReply({
        content: "You don't have permission to use this. Missing node: patrol.manage.promotion",
      });
      return;
    }

    const parsed = parseCustomId(interaction.customId);
    if (!parsed) {
      await interaction.editReply({ content: "❌ Invalid button data." });
      return;
    }

    const { userId, currentRankRoleId, nextRankRoleId } = parsed;

    try {
      if (interaction.channel?.isThread()) {
        await interaction.editReply({
          content: `💬 This promotion is already in a thread: ${interaction.channel.url}`,
        });
        return;
      }

      const message = interaction.message;
      if (message.hasThread && message.thread) {
        await interaction.editReply({
          content: `💬 A thread already exists: ${message.thread.url}`,
        });
        return;
      }

      const currentRankName = scrubRoleDisplay(
        interaction.guild.roles.cache.get(currentRankRoleId)?.name ?? "Current",
      );
      const nextRankName = scrubRoleDisplay(
        interaction.guild.roles.cache.get(nextRankRoleId)?.name ?? "Next",
      );
      const mainAccount = await getMainVRChatAccountInfo(userId);
      const threadName = buildPromotionThreadName(mainAccount, currentRankName, nextRankName);

      const thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: 10080,
        reason: `Promotion discussion started by ${interaction.user.tag}`,
      });

      await interaction.editReply({
        content: `💬 Thread created: ${thread.url}`,
      });

      loggers.patrol.info(
        `Promotion thread created for user ${userId}: ${threadName} by ${interaction.user.tag}`,
      );
    } catch (err) {
      loggers.patrol.error("Promotion thread error", err);
      await interaction.editReply({
        content: "❌ An error occurred while creating the thread.",
      });
    }
  }
}
