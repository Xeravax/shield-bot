import type { CommandInteraction } from "discord.js";
import { prisma, bot, loaManager } from "../../main.js";
import { EmbedBuilder, Colors } from "discord.js";
import { loggers } from "../../utility/logger.js";
import { isBlockingLOA, BLOCKING_LOA_ATTENDANCE_MESSAGE } from "../loa/loaManager.js";

export class AttendanceManager {
  async createEvent(date: Date, hostId?: number, cohostId?: number) {
    return prisma.attendanceEvent.create({
      data: {
        date,
        hostId,
        cohostId,
      },
    });
  }

  async addUserToSquad(
    eventId: number,
    userId: number | undefined,
    squadName: string,
    guildId?: string,
  ) {
    if (!userId)
      {throw new Error(
        "User ID is undefined. Make sure the user exists in the database.",
      );}
    if (guildId) {
      await this.assertNotOnBlockingLOA(guildId, userId);
    }
    let squad = await prisma.squad.findFirst({
      where: { eventId, name: squadName },
    });
    if (!squad) {
      squad = await prisma.squad.create({ data: { eventId, name: squadName } });
    }
    return prisma.squadMember.create({ data: { userId, squadId: squad.id } });
  }

  async removeUserFromEvent(eventId: number, userId: number) {
    // Instead of deleting, mark as left to preserve attendance record
    await this.markUserAsLeft(eventId, userId);
  }

  async forceRemoveUserFromEvent(eventId: number, userId: number) {
    // This method completely removes the user from the event (original behavior)
    const squads = await prisma.squad.findMany({ where: { eventId } });
    for (const squad of squads) {
      await prisma.squadMember.deleteMany({
        where: { squadId: squad.id, userId },
      });
    }
    await prisma.attendanceStaff.deleteMany({ where: { eventId, userId } });
  }

  async moveUserToSquad(eventId: number, userId: number, newSquadName: string, guildId?: string) {
    if (guildId) {
      await this.assertNotOnBlockingLOA(guildId, userId);
    }
    const squads = await prisma.squad.findMany({ where: { eventId } });
    for (const squad of squads) {
      await prisma.squadMember.deleteMany({
        where: { squadId: squad.id, userId },
      });
    }
    const result = await this.addUserToSquad(eventId, userId, newSquadName);

    // Clear the left status when moving to a new squad
    const member = await prisma.squadMember.findFirst({
      where: { squad: { eventId, name: newSquadName }, userId },
    });
    if (member) {
      await prisma.squadMember.update({
        where: { id: member.id },
        data: { hasLeft: false },
      });
    }

    return result;
  }

  async markUserAsLead(eventId: number, userId: number) {
    const member = await prisma.squadMember.findFirst({
      where: { squad: { eventId }, userId },
    });
    if (member) {
      await prisma.squadMember.update({
        where: { id: member.id },
        data: { isLead: true },
      });
    }
  }

  async markUserAsLate(eventId: number, userId: number) {
    const member = await prisma.squadMember.findFirst({
      where: { squad: { eventId }, userId },
    });
    if (member) {
      await prisma.squadMember.update({
        where: { id: member.id },
        data: { isLate: true },
      });
    }
  }

  async markUserAsSplit(
    eventId: number,
    userId: number,
    newSquadName: string,
    splitFrom: string,
    guildId?: string,
  ) {
    if (guildId) {
      await this.assertNotOnBlockingLOA(guildId, userId);
    }
    // Check if splitting from AOC - if so, keep them in AOC and add to new squad
    const guildSettings = guildId 
      ? await prisma.guildSettings.findUnique({ where: { guildId } })
      : null;
    
    const aocChannelId = (guildSettings as { aocChannelId?: string | null } | null)?.aocChannelId;
    const isSplittingFromAOC = aocChannelId && splitFrom === aocChannelId;

    if (isSplittingFromAOC) {
      // Keep user in AOC squad, but also add them to new squad
      // First, get the AOC squad member to check if they were a lead
      const aocSquad = await prisma.squad.findFirst({
        where: { eventId, name: aocChannelId },
      });
      
      let wasLeadInAOC = false;
      if (aocSquad) {
        const aocMember = await prisma.squadMember.findFirst({
          where: { squadId: aocSquad.id, userId },
        });
        wasLeadInAOC = aocMember?.isLead || false;
      }

      // Add to new squad without removing from AOC
      await this.addUserToSquad(eventId, userId, newSquadName, guildId);
      const member = await prisma.squadMember.findFirst({
        where: { squad: { eventId, name: newSquadName }, userId },
      });
      if (member) {
        await prisma.squadMember.update({
          where: { id: member.id },
          data: { isSplit: true, splitFrom },
        });
      }

      // Send DM reminder if they were a lead in AOC
      if (wasLeadInAOC && guildId) {
        const instigationLogChannelId = (guildSettings as { instigationLogChannelId?: string | null } | null)?.instigationLogChannelId;
        await this.sendAOCSplitReminderDM(userId, guildId, instigationLogChannelId);
      }
    } else {
      // Normal split - move user (removes from old squad, adds to new)
      await this.moveUserToSquad(eventId, userId, newSquadName, guildId);
      const member = await prisma.squadMember.findFirst({
        where: { squad: { eventId, name: newSquadName }, userId },
      });
      if (member) {
        await prisma.squadMember.update({
          where: { id: member.id },
          data: { isSplit: true, splitFrom },
        });
      }
    }
  }

  /**
   * Prevent squad changes for users on an active blocking LOA.
   */
  private async assertNotOnBlockingLOA(guildId: string, userId: number): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { discordId: true },
    });
    if (!user) {
      return;
    }

    const loa = await loaManager.getActiveLOA(guildId, user.discordId);
    if (isBlockingLOA(loa)) {
      throw new Error(BLOCKING_LOA_ATTENDANCE_MESSAGE);
    }
  }

  /**
   * Send DM reminder to user when they're split from AOC and were a lead
   */
  private async sendAOCSplitReminderDM(
    userId: number,
    guildId: string,
    instigationLogChannelId?: string | null,
  ) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user?.discordId) {
        return;
      }

      const guild = bot.guilds.cache.get(guildId);
      if (!guild) {
        return;
      }

      const member = await guild.members.fetch(user.discordId).catch(() => null);
      if (!member) {
        return;
      }

      let logChannelMention = "the instigation log channel";
      if (instigationLogChannelId) {
        logChannelMention = `<#${instigationLogChannelId}>`;
      }

      const embed = new EmbedBuilder()
        .setTitle("📋 AOC Squad Split Reminder")
        .setDescription(
          `You just went from your AOC squad to a normal patrol squad.\n` +
          `If you just ***leaded*** the AOC instigation, please remember to make a log in ${logChannelMention}.`,
        )
        .setColor(Colors.Orange)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Attendance System" })
        .setTimestamp();

      try {
        await member.user.send({ embeds: [embed] });
        loggers.bot.info(`Sent AOC split reminder DM to ${member.user.tag}`);
      } catch (dmError: unknown) {
        // If DM fails (user has DMs disabled, etc.), log but don't throw
        loggers.bot.warn(`Failed to send AOC split reminder DM to ${user.discordId}`, dmError);
      }
    } catch (err) {
      loggers.bot.error("sendAOCSplitReminderDM error", err);
    }
  }

  async addStaff(eventId: number, userId: number) {
    // Find if a staff entry already exists for this event/user
    const existing = await prisma.attendanceStaff.findFirst({
      where: { eventId, userId },
    });
    if (existing) {
      return existing;
    }
    return prisma.attendanceStaff.create({ data: { eventId, userId } });
  }

  async setCohost(eventId: number, userId: number) {
    return prisma.attendanceEvent.update({
      where: { id: eventId },
      data: { cohostId: userId },
    });
  }

  async getEventSummary(eventId: number) {
    return prisma.attendanceEvent.findUnique({
      where: { id: eventId },
      include: {
        host: true,
        cohost: true,
        staff: { include: { user: true } },
        squads: {
          include: {
            members: { include: { user: true } },
          },
        },
      },
    });
  }

  // Find or create a user by Discord ID
  async findOrCreateUserByDiscordId(discordId: string | undefined) {
    if (!discordId)
      {throw new Error("Discord ID is undefined. Cannot find or create user.");}
    let user = await prisma.user.findUnique({ where: { discordId } });
    if (!user) {
      user = await prisma.user.create({ data: { discordId } });
    }
    return user;
  }

  // Set the active event for a user (by userId)
  async setActiveEventForUser(userId: number, eventId: number) {
    // Store in a simple table: ActiveAttendanceEvent { id, userId, eventId }
    await prisma.activeAttendanceEvent.upsert({
      where: { userId },
      update: { eventId },
      create: { userId, eventId },
    });
  }

  // Get the active event for a user (by userId)
  async getActiveEventIdForUser(userId: number) {
    const active = await prisma.activeAttendanceEvent.findUnique({
      where: { userId },
      include: { event: true },
    });
    
    if (!active) {
      return undefined;
    }

    // Check if the event is older than 4 hours
    const eventDate = new Date(active.event.date);
    const fourHoursAfterEvent = new Date(eventDate.getTime() + 4 * 60 * 60 * 1000);
    const now = new Date();

    if (now > fourHoursAfterEvent) {
      // Auto-clear the active event if it's been more than 4 hours since the event date
      await this.clearActiveEventForUser(userId);
      return undefined;
    }

    return active.eventId;
  }

  // Clear the active event for a user (by userId)
  async clearActiveEventForUser(userId: number) {
    await prisma.activeAttendanceEvent.deleteMany({ where: { userId } });
  }

  // Helper to get the active event for the current user
  async getActiveEventForInteraction(interaction: CommandInteraction) {
    const discordId = interaction.user.id;
    const user = await this.findOrCreateUserByDiscordId(discordId);
    const eventId = await this.getActiveEventIdForUser(user.id);
    if (!eventId) {
      return null;
    }
    return { eventId, user };
  }

  // Delete all data related to an event (squads, squad members, staff, etc.)
  async deleteEventData(eventId: number) {
    // Delete all squad members for squads in this event
    const squads = await prisma.squad.findMany({ where: { eventId } });
    for (const squad of squads) {
      await prisma.squadMember.deleteMany({ where: { squadId: squad.id } });
    }
    // Delete all squads for this event
    await prisma.squad.deleteMany({ where: { eventId } });
    // Delete all staff for this event
    await prisma.attendanceStaff.deleteMany({ where: { eventId } });
    // Clear active event references
    await prisma.activeAttendanceEvent.deleteMany({ where: { eventId } });
    // Delete the event itself
    await prisma.attendanceEvent.delete({ where: { id: eventId } });
  }

  // Get events accessible to a user (host, cohost, or has participated)
  async getUserEvents(userId: number) {
    return prisma.attendanceEvent.findMany({
      where: {
        OR: [
          { hostId: userId },
          { cohostId: userId },
          {
            staff: {
              some: { userId },
            },
          },
          {
            squads: {
              some: {
                members: {
                  some: { userId },
                },
              },
            },
          },
        ],
      },
      include: {
        host: true,
        cohost: true,
        staff: true,
        squads: {
          include: {
            members: true,
          },
        },
      },
      orderBy: {
        date: "desc",
      },
    });
  }

  // Get all events (for selection/assistance by anyone)
  async getAllEvents() {
    return prisma.attendanceEvent.findMany({
      include: {
        host: true,
        cohost: true,
        staff: true,
        squads: {
          include: {
            members: true,
          },
        },
      },
      orderBy: {
        date: "desc",
      },
    });
  }

  // Get event by ID
  async getEventById(eventId: number) {
    return prisma.attendanceEvent.findUnique({
      where: { id: eventId },
      include: {
        host: true,
        cohost: true,
      },
    });
  }

  // Mark user as left
  async markUserAsLeft(eventId: number, userId: number) {
    const member = await prisma.squadMember.findFirst({
      where: { squad: { eventId }, userId },
    });
    if (member) {
      await prisma.squadMember.update({
        where: { id: member.id },
        data: { hasLeft: true },
      });
    }
  }
}
