import { prisma } from "../main.js";

export interface UserExportPayload {
  exportedAt: string;
  discordId: string;
  vrchatAccounts: Array<{
    vrcUserId: string;
    accountType: string;
    vrchatUsername: string | null;
    usernameUpdatedAt: string | null;
  }>;
  userPreferences: {
    patrolDmDisabled: boolean;
    createdAt: string;
    updatedAt: string;
  } | null;
  whitelistEntries: Array<{
    guildId: string;
    createdAt: string;
    updatedAt: string;
    roleAssignments: Array<{
      roleId: number;
      assignedAt: string;
      expiresAt: string | null;
    }>;
  }>;
  voicePatrolTimes: Array<{
    guildId: string;
    totalMs: string;
    channelId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  voicePatrolMonthlyTimes: Array<{
    guildId: string;
    year: number;
    month: number;
    totalMs: string;
    createdAt: string;
    updatedAt: string;
  }>;
  voicePatrolPromotions: Array<{
    guildId: string;
    totalHours: number;
    notifiedAt: string;
  }>;
  leaveOfAbsences: Array<{
    guildId: string;
    requestedAt: string;
    startDate: string;
    endDate: string;
    reason: string;
    status: string;
    endedEarlyAt: string | null;
    notificationsPaused: boolean;
    cooldownEndDate: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  roleAssignmentTracking: Array<{
    guildId: string;
    roleId: string;
    assignedAt: string;
    createdAt: string;
    updatedAt: string;
  }>;
  roleTrackingWarnings: Array<{
    guildId: string;
    roleId: string;
    warningType: string;
    warningIndex: number;
    sentAt: string;
    roleAssignedAt: string;
    createdAt: string;
  }>;
  attendance: {
    asHost: Array<{ eventId: number; date: string; createdAt: string }>;
    asCohost: Array<{ eventId: number; date: string; createdAt: string }>;
    asStaff: Array<{ eventId: number; date: string; createdAt: string }>;
    asSquadMember: Array<{
      eventId: number;
      date: string;
      createdAt: string;
      squadName: string;
      isLead: boolean;
      isLate: boolean;
      isSplit: boolean;
      hasLeft: boolean;
    }>;
    activeEventId: number | null;
  };
}

function toIso(date: Date): string {
  return date.toISOString();
}

export async function getUserExportData(
  discordId: string,
): Promise<UserExportPayload | null> {
  const user = await prisma.user.findUnique({
    where: { discordId },
    include: {
      vrchatAccounts: true,
      userPreferences: true,
      whitelistEntries: {
        include: {
          roleAssignments: { select: { roleId: true, assignedAt: true, expiresAt: true } },
        },
      },
      voicePatrolTimes: true,
      voicePatrolMonthly: true,
      leaveOfAbsences: true,
      roleAssignmentTracking: true,
      roleTrackingWarnings: true,
      hostAttendanceEvents: true,
      cohostAttendanceEvents: true,
      attendanceStaff: { include: { event: true } },
      squadMemberships: {
        include: { squad: { include: { event: true } } },
      },
      activeAttendanceEvent: { include: { event: true } },
    },
  });

  if (!user) {
    return null;
  }

  const voicePatrolPromotions = await prisma.voicePatrolPromotion.findMany({
    where: { userId: user.discordId },
  });

  const payload: UserExportPayload = {
    exportedAt: toIso(new Date()),
    discordId: user.discordId,
    vrchatAccounts: user.vrchatAccounts.map((a) => ({
      vrcUserId: a.vrcUserId,
      accountType: a.accountType,
      vrchatUsername: a.vrchatUsername,
      usernameUpdatedAt: a.usernameUpdatedAt ? toIso(a.usernameUpdatedAt) : null,
    })),
    userPreferences: user.userPreferences
      ? {
          patrolDmDisabled: user.userPreferences.patrolDmDisabled,
          createdAt: toIso(user.userPreferences.createdAt),
          updatedAt: toIso(user.userPreferences.updatedAt),
        }
      : null,
    whitelistEntries: user.whitelistEntries.map((e) => ({
      guildId: e.guildId,
      createdAt: toIso(e.createdAt),
      updatedAt: toIso(e.updatedAt),
      roleAssignments: e.roleAssignments.map((ra) => ({
        roleId: ra.roleId,
        assignedAt: toIso(ra.assignedAt),
        expiresAt: ra.expiresAt ? toIso(ra.expiresAt) : null,
      })),
    })),
    voicePatrolTimes: user.voicePatrolTimes.map((t) => ({
      guildId: t.guildId,
      totalMs: t.totalMs.toString(),
      channelId: t.channelId,
      createdAt: toIso(t.createdAt),
      updatedAt: toIso(t.updatedAt),
    })),
    voicePatrolMonthlyTimes: user.voicePatrolMonthly.map((t) => ({
      guildId: t.guildId,
      year: t.year,
      month: t.month,
      totalMs: t.totalMs.toString(),
      createdAt: toIso(t.createdAt),
      updatedAt: toIso(t.updatedAt),
    })),
    voicePatrolPromotions: voicePatrolPromotions.map((p) => ({
      guildId: p.guildId,
      totalHours: p.totalHours,
      notifiedAt: toIso(p.notifiedAt),
    })),
    leaveOfAbsences: user.leaveOfAbsences.map((l) => ({
      guildId: l.guildId,
      requestedAt: toIso(l.requestedAt),
      startDate: toIso(l.startDate),
      endDate: toIso(l.endDate),
      reason: l.reason,
      status: l.status,
      endedEarlyAt: l.endedEarlyAt ? toIso(l.endedEarlyAt) : null,
      notificationsPaused: l.notificationsPaused,
      cooldownEndDate: l.cooldownEndDate ? toIso(l.cooldownEndDate) : null,
      createdAt: toIso(l.createdAt),
      updatedAt: toIso(l.updatedAt),
    })),
    roleAssignmentTracking: user.roleAssignmentTracking.map((r) => ({
      guildId: r.guildId,
      roleId: r.roleId,
      assignedAt: toIso(r.assignedAt),
      createdAt: toIso(r.createdAt),
      updatedAt: toIso(r.updatedAt),
    })),
    roleTrackingWarnings: user.roleTrackingWarnings.map((w) => ({
      guildId: w.guildId,
      roleId: w.roleId,
      warningType: w.warningType,
      warningIndex: w.warningIndex,
      sentAt: toIso(w.sentAt),
      roleAssignedAt: toIso(w.roleAssignedAt),
      createdAt: toIso(w.createdAt),
    })),
    attendance: {
      asHost: user.hostAttendanceEvents.map((e) => ({
        eventId: e.id,
        date: toIso(e.date),
        createdAt: toIso(e.createdAt),
      })),
      asCohost: user.cohostAttendanceEvents.map((e) => ({
        eventId: e.id,
        date: toIso(e.date),
        createdAt: toIso(e.createdAt),
      })),
      asStaff: user.attendanceStaff.map((s) => ({
        eventId: s.event.id,
        date: toIso(s.event.date),
        createdAt: toIso(s.event.createdAt),
      })),
      asSquadMember: user.squadMemberships.map((m) => ({
        eventId: m.squad.event.id,
        date: toIso(m.squad.event.date),
        createdAt: toIso(m.squad.event.createdAt),
        squadName: m.squad.name,
        isLead: m.isLead,
        isLate: m.isLate,
        isSplit: m.isSplit,
        hasLeft: m.hasLeft,
      })),
      activeEventId: user.activeAttendanceEvent?.eventId ?? null,
    },
  };

  return payload;
}
