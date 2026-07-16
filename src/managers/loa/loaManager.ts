import {
  Client,
  Colors,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { prisma } from "../../main.js";
import { formatDuration, parseRelativeTime } from "../../utility/timeParser.js";
import { loggers } from "../../utility/logger.js";
import type { LeaveOfAbsence } from "../../generated/prisma/client.js";
import { LeaveOfAbsenceStatus, LeaveOfAbsenceType } from "../../generated/prisma/client.js";

const DEFAULT_LOA_COOLDOWN_DAYS = 14;
const DEFAULT_MINIMUM_REQUEST_TIME_DAYS = 30;

export type LOAEmbedStatus = "pending" | "approved" | "active" | "denied" | "expired" | "ended_early";

export function isBlockingLOA(loa: { type: LeaveOfAbsenceType } | null | undefined): boolean {
  return loa?.type === LeaveOfAbsenceType.BLOCKING;
}

export function blocksPatrolTracking(loa: { type: LeaveOfAbsenceType } | null | undefined): boolean {
  return isBlockingLOA(loa);
}

export function formatLOATypeLabel(type: LeaveOfAbsenceType): string {
  return type === LeaveOfAbsenceType.ATTENDABLE ? "Attendable" : "Blocking";
}

export const BLOCKING_LOA_ATTENDANCE_MESSAGE =
  "User has an active blocking leave of absence and cannot participate in event attendance.";

export type LOAWithUser = LeaveOfAbsence & {
  user: { discordId: string };
};

export function buildLOARequestEmbed(
  loa: {
    id?: number;
    user: { discordId: string };
    startDate: Date;
    endDate: Date;
    reason: string;
    type?: LeaveOfAbsenceType;
    status?: string;
    approvedBy?: string | null;
    deniedBy?: string | null;
    denialReason?: string | null;
    endedEarlyAt?: Date | null;
    cooldownEndDate?: Date | null;
  },
  status: LOAEmbedStatus,
): EmbedBuilder {
  const reasonDisplay = loa.reason.length > 1024 ? loa.reason.slice(0, 1021) + "…" : loa.reason;
  const statusLabels: Record<LOAEmbedStatus, string> = {
    pending: "**Status:** Pending Approval",
    approved: "**Status:** ✅ Approved",
    active: "**Status:** ✅ Active",
    denied: "**Status:** ❌ Denied",
    expired: "**Status:** ⏰ Ended (scheduled end reached)",
    ended_early: "**Status:** ⚠️ Ended Early",
  };

  const embed = new EmbedBuilder()
    .setTitle("Leave of Absence Request")
    .setDescription(`**User:** <@${loa.user.discordId}>\n${statusLabels[status]}`)
    .addFields({
      name: "Duration",
      value: formatDuration(loa.endDate.getTime() - loa.startDate.getTime()),
      inline: true,
    });

  if (loa.type) {
    embed.addFields({
      name: "Type",
      value: formatLOATypeLabel(loa.type),
      inline: true,
    });
  }

  if (status === "expired" || status === "pending" || status === "approved" || status === "active" || status === "denied") {
    embed.addFields(
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
    );
  }

  if (status === "ended_early") {
    embed.addFields(
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
    );
  }

  embed.addFields({ name: "Reason", value: reasonDisplay });

  if (loa.approvedBy && (status === "approved" || status === "active" || status === "expired" || status === "ended_early")) {
    embed.addFields({
      name: "Approved By",
      value: `<@${loa.approvedBy}>`,
      inline: true,
    });
  }

  if (loa.deniedBy && status === "denied") {
    embed.addFields({
      name: "Denied By",
      value: `<@${loa.deniedBy}>`,
      inline: true,
    });
  }

  if (loa.denialReason && status === "denied") {
    embed.addFields({ name: "Denial Reason", value: loa.denialReason });
  }

  const colorMap: Record<LOAEmbedStatus, number> = {
    pending: Colors.Orange,
    approved: Colors.Green,
    active: Colors.Green,
    denied: Colors.Red,
    expired: Colors.Blue,
    ended_early: Colors.Orange,
  };
  embed.setColor(colorMap[status]).setTimestamp();
  return embed;
}

export function getLOAMessageLink(loa: {
  guildId: string;
  announcementChannelId?: string | null;
  announcementMessageId?: string | null;
}): string | null {
  if (!loa.announcementChannelId || !loa.announcementMessageId) {
    return null;
  }
  return `https://discord.com/channels/${loa.guildId}/${loa.announcementChannelId}/${loa.announcementMessageId}`;
}

export interface LOA {
  id: number;
  startDate: Date;
  endDate: Date;
  reason: string;
  status: string;
}

export type LOARequestResult =
  | { success: true; loa: LeaveOfAbsence }
  | { success: false; error: string; loa?: never };

export class LOAManager {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  private async getPatrolTimer() {
    const { patrolTimer } = await import("../../main.js");
    return patrolTimer;
  }

  /**
   * Request a new LOA
   */
  async requestLOA(
    guildId: string,
    discordId: string,
    timeString: string,
    reason: string,
    type: LeaveOfAbsenceType,
  ): Promise<LOARequestResult> {
    try {
      // Parse time string
      const parseResult = parseRelativeTime(timeString);
      if (!parseResult.success || !parseResult.endDate) {
        return {
          success: false,
          error: parseResult.error || "Failed to parse time",
        };
      }

      const startDate = new Date();
      const endDate = parseResult.endDate;

      // Check cooldown before accepting new LOA
      const cooldown = await this.checkCooldown(guildId, discordId);
      if (cooldown.inCooldown && cooldown.cooldownEndDate) {
        const cooldownEnd = `<t:${Math.floor(cooldown.cooldownEndDate.getTime() / 1000)}:F>`;
        return {
          success: false,
          error: `You are in a cooldown period until ${cooldownEnd}. You cannot request a new LOA until then.`,
        };
      }

      // Validate minimum request time
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
        select: { minimumRequestTimeDays: true },
      });
      const minimumDays = settings?.minimumRequestTimeDays ?? DEFAULT_MINIMUM_REQUEST_TIME_DAYS;
      const durationMs = endDate.getTime() - startDate.getTime();
      const durationDays = durationMs / (1000 * 60 * 60 * 24);
      
      if (durationDays < minimumDays) {
        return {
          success: false,
          error: `LOA duration must be at least ${minimumDays} day${minimumDays !== 1 ? "s" : ""}. Your requested duration is approximately ${Math.round(durationDays * 10) / 10} day${Math.round(durationDays * 10) / 10 !== 1 ? "s" : ""}.`,
        };
      }

      // Get or create user
      let user = await prisma.user.findUnique({
        where: { discordId },
      });

      if (!user) {
        user = await prisma.user.create({
          data: { discordId },
        });
      }

      // Check for existing active/pending LOA and replace it
      const existingLOA = await prisma.leaveOfAbsence.findFirst({
        where: {
          userId: user.id,
          guildId,
          status: {
            in: ["PENDING", "APPROVED", "ACTIVE"],
          },
        },
      });

      if (existingLOA) {
        // Replace existing LOA
        const updatedLOA = await prisma.leaveOfAbsence.update({
          where: { id: existingLOA.id },
          data: {
            requestedAt: new Date(),
            startDate,
            endDate,
            reason,
            type,
            status: "PENDING",
            approvedBy: null,
            deniedBy: null,
            denialReason: null,
            endedEarlyAt: null,
            notificationsPaused: false,
            cooldownEndDate: null,
            announcementChannelId: null,
            announcementMessageId: null,
          },
        });

        return {
          success: true,
          loa: updatedLOA,
        };
      }

      // Create new LOA
      const loa = await prisma.leaveOfAbsence.create({
        data: {
          userId: user.id,
          guildId,
          requestedAt: new Date(),
          startDate,
          endDate,
          reason,
          type,
          status: "PENDING",
        },
      });

      return {
        success: true,
        loa,
      };
    } catch (error) {
      loggers.bot.error("Error requesting LOA", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Approve an LOA request
   */
  async approveLOA(loaId: number, staffDiscordId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const loa = await prisma.leaveOfAbsence.findUnique({
        where: { id: loaId },
        include: { user: true },
      });

      if (!loa) {
        return { success: false, error: "LOA not found" };
      }

      if (loa.status !== "PENDING") {
        return { success: false, error: "LOA is not pending approval" };
      }

      // Update LOA status
      const now = new Date();
      const status = loa.startDate <= now ? "ACTIVE" : "APPROVED";

      await prisma.leaveOfAbsence.update({
        where: { id: loaId },
        data: {
          status,
          approvedBy: staffDiscordId,
        },
      });

      // Assign LOA role if status is ACTIVE
      if (status === "ACTIVE") {
        await this.assignLOARole(loa.guildId, loa.user.discordId);
        const patrolTimer = await this.getPatrolTimer();
        await patrolTimer.pausePromotionCooldown(loa.guildId, loa.user.discordId);
      }

      return { success: true };
    } catch (error) {
      loggers.bot.error("Error approving LOA", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Deny an LOA request
   */
  async denyLOA(
    loaId: number,
    staffDiscordId: string,
    reason?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const loa = await prisma.leaveOfAbsence.findUnique({
        where: { id: loaId },
      });

      if (!loa) {
        return { success: false, error: "LOA not found" };
      }

      if (loa.status !== "PENDING") {
        return { success: false, error: "LOA is not pending approval" };
      }

      await prisma.leaveOfAbsence.update({
        where: { id: loaId },
        data: {
          status: "DENIED",
          deniedBy: staffDiscordId,
          denialReason: reason || null,
        },
      });

      return { success: true };
    } catch (error) {
      loggers.bot.error("Error denying LOA", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * End LOA early
   */
  async endEarly(loaId: number, discordId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const loa = await prisma.leaveOfAbsence.findUnique({
        where: { id: loaId },
        include: { user: true },
      });

      if (!loa) {
        return { success: false, error: "LOA not found" };
      }

      if (loa.user.discordId !== discordId) {
        return { success: false, error: "You don't own this LOA" };
      }

      if (loa.status !== "ACTIVE" && loa.status !== "APPROVED") {
        return { success: false, error: "LOA is not active" };
      }

      const now = new Date();
      // Get cooldown days from guild settings or use default
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: loa.guildId },
        select: { leaveOfAbsenceCooldownDays: true },
      });
      const cooldownDays = settings?.leaveOfAbsenceCooldownDays ?? DEFAULT_LOA_COOLDOWN_DAYS;
      const cooldownEndDate = new Date(now.getTime() + cooldownDays * 24 * 60 * 60 * 1000);

      await prisma.leaveOfAbsence.update({
        where: { id: loaId },
        data: {
          status: "ENDED_EARLY",
          endedEarlyAt: now,
          cooldownEndDate,
        },
      });

      // Remove LOA role
      await this.removeLOARole(loa.guildId, discordId);

      const patrolTimer = await this.getPatrolTimer();
      await patrolTimer.resumePromotionCooldown(loa.guildId, discordId);

      return { success: true };
    } catch (error) {
      loggers.bot.error("Error ending LOA early", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get active LOA for a user
   */
  async getActiveLOA(guildId: string, discordId: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { discordId },
      });

      if (!user) {
        return null;
      }

      return await prisma.leaveOfAbsence.findFirst({
        where: {
          userId: user.id,
          guildId,
          status: {
            in: ["ACTIVE", "APPROVED"],
          },
        },
        include: { user: true },
      });
    } catch (error) {
      loggers.bot.error(`Error getting active LOA for user ${discordId} in guild ${guildId}`, error);
      return null;
    }
  }

  /**
   * Assign LOA role to user
   */
  async assignLOARole(guildId: string, discordId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
      });

      if (!settings?.loaRoleId) {
        return { success: false, error: "LOA role not configured for this guild" };
      }

      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(discordId).catch(() => null);
      if (!member) {
        return { success: false, error: "User not found in guild" };
      }
      const role = await guild.roles.fetch(settings.loaRoleId);

      if (!role) {
        return { success: false, error: "LOA role not found in guild" };
      }

      await member.roles.add(role);
      loggers.bot.info(`Assigned LOA role to ${member.displayName} in guild ${guildId}`);

      return { success: true };
    } catch (error) {
      loggers.bot.error("Error assigning LOA role", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Remove LOA role from user
   */
  async removeLOARole(guildId: string, discordId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
      });

      if (!settings?.loaRoleId) {
        // Role not configured, but that's okay - just return success
        return { success: true };
      }

      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(discordId).catch(() => null);

      if (!member) {
        // Member not in guild, that's okay
        return { success: true };
      }

      const role = await guild.roles.fetch(settings.loaRoleId);

      if (!role) {
        return { success: true }; // Role doesn't exist, that's okay
      }

      if (member.roles.cache.has(settings.loaRoleId)) {
        await member.roles.remove(role);
        loggers.bot.info(`Removed LOA role from ${member.displayName} in guild ${guildId}`);
      }

      return { success: true };
    } catch (error) {
      loggers.bot.error("Error removing LOA role", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Persist the public LOA request message so it can be edited when the LOA ends.
   */
  async setAnnouncementMessageIds(loaId: number, channelId: string, messageId: string): Promise<void> {
    await prisma.leaveOfAbsence.update({
      where: { id: loaId },
      data: {
        announcementChannelId: channelId,
        announcementMessageId: messageId,
      },
    });
  }

  /**
   * Edit the original LOA request message to reflect natural expiry or end-early.
   */
  async updateAnnouncementToClosedState(
    loa: LOAWithUser,
    kind: "expired" | "ended_early",
    messageOverride?: { channelId: string; messageId: string },
  ): Promise<void> {
    const channelId = loa.announcementChannelId ?? messageOverride?.channelId;
    const messageId = loa.announcementMessageId ?? messageOverride?.messageId;
    if (!channelId || !messageId) {
      return;
    }

    try {
      const guild = await this.client.guilds.fetch(loa.guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel?.isTextBased() || channel.isDMBased()) {
        return;
      }

      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        return;
      }

      const embed = buildLOARequestEmbed(loa, kind === "expired" ? "expired" : "ended_early");

      await message.edit({
        embeds: [embed],
        components: [],
      });
    } catch (error) {
      loggers.bot.debug("Could not update LOA announcement message", error);
    }
  }

  /**
   * Edit the original LOA request message to show active status with End Early button.
   */
  async updateAnnouncementToActiveState(loa: LOAWithUser): Promise<void> {
    if (!loa.announcementChannelId || !loa.announcementMessageId) {
      return;
    }

    try {
      const guild = await this.client.guilds.fetch(loa.guildId);
      const channel = await guild.channels.fetch(loa.announcementChannelId);
      if (!channel?.isTextBased() || channel.isDMBased()) {
        return;
      }

      const message = await channel.messages.fetch(loa.announcementMessageId).catch(() => null);
      if (!message) {
        return;
      }

      const embed = buildLOARequestEmbed(loa, "active");
      const endEarlyButton = new ButtonBuilder()
        .setCustomId(`loa:end-early:${loa.id}`)
        .setLabel("End Early")
        .setStyle(ButtonStyle.Danger);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(endEarlyButton);

      await message.edit({
        embeds: [embed],
        components: [row],
      });
    } catch (error) {
      loggers.bot.debug("Could not update LOA announcement to active state", error);
    }
  }

  /**
   * Notify user via DM and update the original LOA message when an LOA ends.
   */
  async notifyLOAEnded(
    loa: LOAWithUser,
    kind: "expired" | "ended_early",
    messageOverride?: { channelId: string; messageId: string },
  ): Promise<void> {
    await this.updateAnnouncementToClosedState(loa, kind, messageOverride);

    const messageLink = getLOAMessageLink(loa);
    const linkLine = messageLink ? `\n\n[View your LOA request](${messageLink})` : "";

    let dmContent: string;
    if (kind === "expired") {
      dmContent = `⏰ Your LOA has expired and the LOA role has been removed.${linkLine}`;
    } else {
      const cooldownLine = loa.cooldownEndDate
        ? `\n\nYou are in a cooldown period until <t:${Math.floor(loa.cooldownEndDate.getTime() / 1000)}:F>.`
        : "";
      dmContent = `⚠️ Your LOA has ended early and the LOA role has been removed.${cooldownLine}${linkLine}`;
    }

    try {
      const user = await this.client.users.fetch(loa.user.discordId);
      await user.send({ content: dmContent });
    } catch (_error) {
      loggers.bot.debug(`Could not DM user ${loa.user.discordId} about LOA ending (${kind})`);
    }
  }

  /**
   * Sync LOA state when the LOA role is removed outside the normal bot flow.
   */
  async handleLOARoleRemovedExternally(guildId: string, discordId: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({ where: { discordId } });
      if (!user) {
        return;
      }

      const loa = await prisma.leaveOfAbsence.findFirst({
        where: {
          userId: user.id,
          guildId,
          status: { in: ["ACTIVE", "APPROVED"] },
        },
        include: { user: true },
        orderBy: { id: "desc" },
      });

      if (!loa) {
        const patrolTimer = await this.getPatrolTimer();
        await patrolTimer.resumePromotionCooldown(guildId, discordId);
        return;
      }

      const now = new Date();
      let updatedLoa: LOAWithUser;

      if (loa.endDate <= now) {
        updatedLoa = await prisma.leaveOfAbsence.update({
          where: { id: loa.id },
          data: { status: "EXPIRED" },
          include: { user: true },
        });
        await this.notifyLOAEnded(updatedLoa, "expired");
      } else if (loa.status === "ACTIVE") {
        const settings = await prisma.guildSettings.findUnique({
          where: { guildId },
          select: { leaveOfAbsenceCooldownDays: true },
        });
        const cooldownDays = settings?.leaveOfAbsenceCooldownDays ?? DEFAULT_LOA_COOLDOWN_DAYS;
        const cooldownEndDate = new Date(now.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
        updatedLoa = await prisma.leaveOfAbsence.update({
          where: { id: loa.id },
          data: {
            status: "ENDED_EARLY",
            endedEarlyAt: now,
            cooldownEndDate,
          },
          include: { user: true },
        });
        await this.notifyLOAEnded(updatedLoa, "ended_early");
      } else {
        updatedLoa = await prisma.leaveOfAbsence.update({
          where: { id: loa.id },
          data: { status: "EXPIRED" },
          include: { user: true },
        });
        await this.notifyLOAEnded(updatedLoa, "expired");
      }

      const patrolTimer = await this.getPatrolTimer();
      await patrolTimer.resumePromotionCooldown(guildId, discordId);
    } catch (error) {
      loggers.bot.error(`Error handling external LOA role removal for ${discordId} in guild ${guildId}`, error);
    }
  }

  /**
   * Check if user is in cooldown period
   */
  async checkCooldown(guildId: string, discordId: string): Promise<{ inCooldown: boolean; cooldownEndDate?: Date }> {
    try {
      const user = await prisma.user.findUnique({
        where: { discordId },
      });

      if (!user) {
        return { inCooldown: false };
      }

      const loa = await prisma.leaveOfAbsence.findFirst({
        where: {
          userId: user.id,
          guildId,
          status: "ENDED_EARLY",
          cooldownEndDate: {
            gt: new Date(),
          },
        },
        orderBy: {
          cooldownEndDate: "desc",
        },
      });

      if (loa && loa.cooldownEndDate) {
        return {
          inCooldown: true,
          cooldownEndDate: loa.cooldownEndDate,
        };
      }

      return { inCooldown: false };
    } catch (error) {
      loggers.bot.error(`Error checking cooldown for user ${discordId} in guild ${guildId}`, error);
      return { inCooldown: false };
    }
  }

  /**
   * Remove cooldown for a user (staff only)
   */
  async removeCooldown(guildId: string, discordId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await prisma.user.findUnique({
        where: { discordId },
      });

      if (!user) {
        return { success: false, error: "User not found" };
      }

      // Find the LOA with active cooldown
      const loa = await prisma.leaveOfAbsence.findFirst({
        where: {
          userId: user.id,
          guildId,
          status: "ENDED_EARLY",
          cooldownEndDate: {
            gt: new Date(),
          },
        },
        orderBy: {
          cooldownEndDate: "desc",
        },
      });

      if (!loa) {
        return { success: false, error: "No active cooldown found for this user" };
      }

      // Clear the cooldown
      await prisma.leaveOfAbsence.update({
        where: { id: loa.id },
        data: {
          cooldownEndDate: null,
        },
      });

      return { success: true };
    } catch (error) {
      loggers.bot.error(`Error removing cooldown for user ${discordId} in guild ${guildId}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Toggle notification pause for LOA
   */
  async pauseNotifications(loaId: number): Promise<{ success: boolean; paused?: boolean; error?: string }> {
    try {
      const loa = await prisma.leaveOfAbsence.findUnique({
        where: { id: loaId },
      });

      if (!loa) {
        return { success: false, error: "LOA not found" };
      }

      const updated = await prisma.leaveOfAbsence.update({
        where: { id: loaId },
        data: {
          notificationsPaused: !loa.notificationsPaused,
        },
      });

      return {
        success: true,
        paused: updated.notificationsPaused,
      };
    } catch (error) {
      loggers.bot.error("Error pausing notifications", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get LOAs by status
   */
  async getLOAsByStatus(guildId: string, status: string) {
    // Validate status against enum values
    const validStatuses: string[] = Object.values(LeaveOfAbsenceStatus);
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid LOA status: ${status}. Valid statuses are: ${validStatuses.join(", ")}`);
    }

    return await prisma.leaveOfAbsence.findMany({
      where: {
        guildId,
        status: status as LeaveOfAbsenceStatus,
      },
      include: { user: true },
      orderBy: {
        endDate: "asc",
      },
    });
  }

  /**
   * Get expired LOAs that need role removal
   */
  async getExpiredLOAs(): Promise<Array<{ id: number; guildId: string; user: { discordId: string } }>> {
    const now = new Date();
    const loas = await prisma.leaveOfAbsence.findMany({
      where: {
        status: "ACTIVE",
        endDate: {
          lte: now,
        },
      },
      include: {
        user: true,
      },
    });

    return loas.map((loa) => ({
      id: loa.id,
      guildId: loa.guildId,
      user: { discordId: loa.user.discordId },
    }));
  }

  /**
   * Expire an LOA (remove role and update status to EXPIRED)
   */
  async expireLOA(loaId: number): Promise<{ success: boolean; error?: string }> {
    try {
      const loa = await prisma.leaveOfAbsence.findUnique({
        where: { id: loaId },
        include: { user: true },
      });

      if (!loa) {
        return { success: false, error: "LOA not found" };
      }

      // Remove LOA role first
      const removeResult = await this.removeLOARole(loa.guildId, loa.user.discordId);
      if (!removeResult.success) {
        return { success: false, error: removeResult.error || "Failed to remove LOA role" };
      }

      // Update status to EXPIRED in a transaction
      await prisma.leaveOfAbsence.update({
        where: { id: loaId },
        data: { status: "EXPIRED" },
      });

      const updatedLoa = await prisma.leaveOfAbsence.findUnique({
        where: { id: loaId },
        include: { user: true },
      });

      if (updatedLoa) {
        await this.notifyLOAEnded(updatedLoa, "expired");
      }

      const patrolTimer = await this.getPatrolTimer();
      await patrolTimer.resumePromotionCooldown(loa.guildId, loa.user.discordId);

      return { success: true };
    } catch (error) {
      loggers.bot.error(`Error expiring LOA ${loaId}`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Activate approved LOAs that have reached their start date
   */
  async activateApprovedLOAs(): Promise<void> {
    const now = new Date();
    const loas = await prisma.leaveOfAbsence.findMany({
      where: {
        status: "APPROVED",
        startDate: {
          lte: now,
        },
      },
      include: {
        user: true,
      },
    });

    for (const loa of loas) {
      try {
        await prisma.leaveOfAbsence.update({
          where: { id: loa.id },
          data: { status: "ACTIVE" },
        });

        await this.assignLOARole(loa.guildId, loa.user.discordId);

        const updatedLoa = await prisma.leaveOfAbsence.findUnique({
          where: { id: loa.id },
          include: { user: true },
        });

        if (updatedLoa) {
          await this.updateAnnouncementToActiveState(updatedLoa);
          await this.notifyLOAActivated(updatedLoa);
        }

        const patrolTimer = await this.getPatrolTimer();
        await patrolTimer.pausePromotionCooldown(loa.guildId, loa.user.discordId);
      } catch (error) {
        loggers.bot.error(`Error activating LOA ${loa.id} for user ${loa.user.discordId} in guild ${loa.guildId}`, error);
        // Continue to next LOA instead of stopping
      }
    }
  }

  /**
   * DM user when their approved LOA becomes active via cron.
   */
  async notifyLOAActivated(loa: LOAWithUser): Promise<void> {
    const messageLink = getLOAMessageLink(loa);
    const linkLine = messageLink ? `\n\n[View your LOA request](${messageLink})` : "";

    try {
      const user = await this.client.users.fetch(loa.user.discordId);
      const embed = buildLOARequestEmbed(loa, "active");
      const patrolNote =
        loa.type === LeaveOfAbsenceType.ATTENDABLE
          ? "Your promotion cooldown is paused until your LOA ends. You can still attend events and accrue patrol time."
          : "Your patrol time and promotion cooldowns are paused until your LOA ends.";
      await user.send({
        content: `✅ Your LOA is now **active**. ${patrolNote}${linkLine}`,
        embeds: [embed],
      });
    } catch (_error) {
      loggers.bot.debug(`Could not DM user ${loa.user.discordId} about LOA activation`);
    }
  }
}

// loaManager instance is created in main.ts to avoid circular dependency
