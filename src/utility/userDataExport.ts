import { prisma } from "../main.js";

type ModCaseRole = "target" | "moderator" | "claimedBy";
type ModNoteRole = "target" | "author";
type PlannedEventRole = "host" | "coHost" | "reviewer" | "pendingCoHost";

export interface UserExportPayload {
  exportedAt: string;
  userId: number | null;
  discordId: string;
  vrchatAccounts: Array<{
    vrcUserId: string;
    accountType: string;
    vrchatUsername: string | null;
    usernameUpdatedAt: string | null;
    verificationCode: string | null;
    verificationGuildId: string | null;
    phantomCompilerReason: string | null;
    phantomCompilerEnrolledAt: string | null;
  }>;
  userPreferences: {
    patrolDmDisabled: boolean;
    patrolNoShieldMemberDmDisabled: boolean;
    eventStatusDmDisabled: boolean;
    modReasonPingDisabled: boolean;
    memberCardPublic: boolean;
    timezone: string | null;
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
      assignedBy: string | null;
      expiresAt: string | null;
      discordRoleId: string | null;
      permissions: string | null;
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
  activeVoicePatrolSessions: Array<{
    guildId: string;
    channelId: string;
    startedAt: string;
    createdAt: string;
    updatedAt: string;
  }>;
  voicePatrolPromotionNotifications: Array<{
    guildId: string;
    nextRankRoleId: string;
    totalHoursAtNotify: number | null;
    notifiedAt: string;
    messageId: string | null;
    status: string;
    resolvedAt: string | null;
    resolvedBy: string | null;
  }>;
  voicePatrolRoleObtainedAt: Array<{
    guildId: string;
    roleId: string;
    obtainedAt: string;
    cooldownPausedAt: string | null;
    cooldownPauseAccumulatedMs: string;
  }>;
  voicePatrolPromotionBlocks: Array<{
    guildId: string;
    reason: string | null;
    setBy: string | null;
    createdAt: string;
  }>;
  leaveOfAbsences: Array<{
    guildId: string;
    requestedAt: string;
    startDate: string;
    endDate: string;
    reason: string;
    type: string;
    status: string;
    approvedBy: string | null;
    deniedBy: string | null;
    denialReason: string | null;
    endedEarlyAt: string | null;
    notificationsPaused: boolean;
    cooldownEndDate: string | null;
    announcementChannelId: string | null;
    announcementMessageId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  roleAssignmentTracking: Array<{
    guildId: string;
    roleId: string;
    assignedAt: string;
    assignedBy: string | null;
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
    assignmentTrackingId: number | null;
    deliveryFailed: boolean | null;
    createdAt: string;
  }>;
  attendance: {
    asHost: Array<{
      eventId: number;
      date: string;
      createdAt: string;
      updatedAt: string;
      firstAutofillAt: string | null;
    }>;
    asCohost: Array<{
      eventId: number;
      date: string;
      createdAt: string;
      updatedAt: string;
      firstAutofillAt: string | null;
    }>;
    asStaff: Array<{
      eventId: number;
      date: string;
      createdAt: string;
      updatedAt: string;
      firstAutofillAt: string | null;
    }>;
    asSquadMember: Array<{
      eventId: number;
      date: string;
      createdAt: string;
      squadName: string;
      isLead: boolean;
      isLate: boolean;
      isSplit: boolean;
      splitFrom: string | null;
      hasLeft: boolean;
    }>;
    activeEventId: number | null;
  };
  plannedEvents: Array<{
    id: number;
    guildId: string;
    title: string;
    startTime: string;
    hostId: string;
    coHostId: string | null;
    coHostOpen: boolean;
    duty: string;
    eventType: string | null;
    durationMinutes: number;
    status: string;
    denialReason: string | null;
    reviewedById: string | null;
    planningMessageId: string | null;
    pendingCoHostUserId: string | null;
    coHostRequestMessageId: string | null;
    discordEventId: string | null;
    forceOverride: boolean;
    editResumeStatus: string | null;
    editSnapshot: unknown;
    editStartedAt: string | null;
    createdAt: string;
    updatedAt: string;
    roles: PlannedEventRole[];
  }>;
  cachedMessages: Array<{
    id: number;
    guildId: string;
    channelId: string;
    messageId: string;
    authorId: string;
    content: string | null;
    attachments: unknown;
    embeds: unknown;
    stickers: unknown;
    createdAt: string;
    editedAt: string | null;
    expiresAt: string;
    updatedAt: string;
  }>;
  modCases: Array<{
    id: number;
    guildId: string;
    caseNumber: number;
    type: string;
    targetId: string;
    moderatorId: string;
    reason: string | null;
    claimedBy: string | null;
    claimedReason: string | null;
    claimedAt: string | null;
    logMessageId: string | null;
    logThreadId: string | null;
    expiresAt: string | null;
    active: boolean;
    metadata: unknown;
    createdAt: string;
    updatedAt: string;
    roles: ModCaseRole[];
  }>;
  modUserNotes: Array<{
    id: number;
    guildId: string;
    targetId: string;
    authorId: string;
    content: string;
    createdAt: string;
    updatedAt: string;
    roles: ModNoteRole[];
  }>;
  announcements: Array<{
    id: number;
    content: string;
    createdAt: string;
    createdBy: string | null;
  }>;
  spinTheBottleResponses: Array<{
    id: number;
    content: string;
    createdAt: string;
    createdBy: string | null;
  }>;
  messagePurgeArchives: Array<{
    id: number;
    guildId: string;
    channelId: string;
    moderatorId: string;
    messageCount: number;
    logMessageId: string | null;
    logThreadId: string | null;
    caseId: number | null;
    createdAt: string;
    expiresAt: string;
    updatedAt: string;
  }>;
}

function toIso(date: Date): string {
  return date.toISOString();
}

function toIsoOrNull(date: Date | null | undefined): string | null {
  return date ? toIso(date) : null;
}

function mapAttendanceEvent(e: {
  id: number;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
  firstAutofillAt: Date | null;
}) {
  return {
    eventId: e.id,
    date: toIso(e.date),
    createdAt: toIso(e.createdAt),
    updatedAt: toIso(e.updatedAt),
    firstAutofillAt: toIsoOrNull(e.firstAutofillAt),
  };
}

function emptyLinkedSections(): Pick<
  UserExportPayload,
  | "vrchatAccounts"
  | "userPreferences"
  | "whitelistEntries"
  | "voicePatrolTimes"
  | "voicePatrolMonthlyTimes"
  | "activeVoicePatrolSessions"
  | "voicePatrolPromotionNotifications"
  | "voicePatrolRoleObtainedAt"
  | "voicePatrolPromotionBlocks"
  | "leaveOfAbsences"
  | "roleAssignmentTracking"
  | "roleTrackingWarnings"
  | "attendance"
> {
  return {
    vrchatAccounts: [],
    userPreferences: null,
    whitelistEntries: [],
    voicePatrolTimes: [],
    voicePatrolMonthlyTimes: [],
    activeVoicePatrolSessions: [],
    voicePatrolPromotionNotifications: [],
    voicePatrolRoleObtainedAt: [],
    voicePatrolPromotionBlocks: [],
    leaveOfAbsences: [],
    roleAssignmentTracking: [],
    roleTrackingWarnings: [],
    attendance: {
      asHost: [],
      asCohost: [],
      asStaff: [],
      asSquadMember: [],
      activeEventId: null,
    },
  };
}

export async function getUserExportData(
  discordId: string,
): Promise<UserExportPayload | null> {
  const [
    user,
    plannedEvents,
    cachedMessages,
    modCases,
    modUserNotes,
    announcements,
    spinTheBottleResponses,
    messagePurgeArchives,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { discordId },
      include: {
        vrchatAccounts: true,
        userPreferences: true,
        whitelistEntries: {
          include: {
            roleAssignments: {
              include: {
                role: { select: { discordRoleId: true, permissions: true } },
              },
            },
          },
        },
        voicePatrolTimes: true,
        voicePatrolMonthly: true,
        activeVoicePatrolSessions: true,
        voicePatrolPromotionNotifications: true,
        voicePatrolRoleObtainedAt: true,
        voicePatrolPromotionBlocks: true,
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
    }),
    prisma.plannedEvent.findMany({
      where: {
        OR: [
          { hostId: discordId },
          { coHostId: discordId },
          { reviewedById: discordId },
          { pendingCoHostUserId: discordId },
        ],
      },
    }),
    prisma.cachedMessage.findMany({
      where: { authorId: discordId },
    }),
    prisma.modCase.findMany({
      where: {
        OR: [
          { targetId: discordId },
          { moderatorId: discordId },
          { claimedBy: discordId },
        ],
      },
    }),
    prisma.modUserNote.findMany({
      where: {
        OR: [{ targetId: discordId }, { authorId: discordId }],
      },
    }),
    prisma.announcement.findMany({
      where: { createdBy: discordId },
    }),
    prisma.spinTheBottleResponse.findMany({
      where: { createdBy: discordId },
    }),
    prisma.messagePurgeArchive.findMany({
      where: { moderatorId: discordId },
      select: {
        id: true,
        guildId: true,
        channelId: true,
        moderatorId: true,
        messageCount: true,
        logMessageId: true,
        logThreadId: true,
        caseId: true,
        createdAt: true,
        expiresAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const hasDiscordIdOnlyData =
    plannedEvents.length > 0 ||
    cachedMessages.length > 0 ||
    modCases.length > 0 ||
    modUserNotes.length > 0 ||
    announcements.length > 0 ||
    spinTheBottleResponses.length > 0 ||
    messagePurgeArchives.length > 0;

  if (!user && !hasDiscordIdOnlyData) {
    return null;
  }

  const linked = user
    ? {
        vrchatAccounts: user.vrchatAccounts.map((a) => ({
          vrcUserId: a.vrcUserId,
          accountType: a.accountType,
          vrchatUsername: a.vrchatUsername,
          usernameUpdatedAt: toIsoOrNull(a.usernameUpdatedAt),
          verificationCode: a.verificationCode,
          verificationGuildId: a.verificationGuildId,
          phantomCompilerReason: a.phantomCompilerReason,
          phantomCompilerEnrolledAt: toIsoOrNull(a.phantomCompilerEnrolledAt),
        })),
        userPreferences: user.userPreferences
          ? {
              patrolDmDisabled: user.userPreferences.patrolDmDisabled,
              patrolNoShieldMemberDmDisabled:
                user.userPreferences.patrolNoShieldMemberDmDisabled,
              eventStatusDmDisabled: user.userPreferences.eventStatusDmDisabled,
              modReasonPingDisabled: user.userPreferences.modReasonPingDisabled,
              memberCardPublic: user.userPreferences.memberCardPublic,
              timezone: user.userPreferences.timezone,
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
            assignedBy: ra.assignedBy,
            expiresAt: toIsoOrNull(ra.expiresAt),
            discordRoleId: ra.role.discordRoleId,
            permissions: ra.role.permissions,
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
        activeVoicePatrolSessions: user.activeVoicePatrolSessions.map((s) => ({
          guildId: s.guildId,
          channelId: s.channelId,
          startedAt: toIso(s.startedAt),
          createdAt: toIso(s.createdAt),
          updatedAt: toIso(s.updatedAt),
        })),
        voicePatrolPromotionNotifications:
          user.voicePatrolPromotionNotifications.map((n) => ({
            guildId: n.guildId,
            nextRankRoleId: n.nextRankRoleId,
            totalHoursAtNotify: n.totalHoursAtNotify,
            notifiedAt: toIso(n.notifiedAt),
            messageId: n.messageId,
            status: n.status,
            resolvedAt: toIsoOrNull(n.resolvedAt),
            resolvedBy: n.resolvedBy,
          })),
        voicePatrolRoleObtainedAt: user.voicePatrolRoleObtainedAt.map((r) => ({
          guildId: r.guildId,
          roleId: r.roleId,
          obtainedAt: toIso(r.obtainedAt),
          cooldownPausedAt: toIsoOrNull(r.cooldownPausedAt),
          cooldownPauseAccumulatedMs: r.cooldownPauseAccumulatedMs.toString(),
        })),
        voicePatrolPromotionBlocks: user.voicePatrolPromotionBlocks.map(
          (b) => ({
            guildId: b.guildId,
            reason: b.reason,
            setBy: b.setBy,
            createdAt: toIso(b.createdAt),
          }),
        ),
        leaveOfAbsences: user.leaveOfAbsences.map((l) => ({
          guildId: l.guildId,
          requestedAt: toIso(l.requestedAt),
          startDate: toIso(l.startDate),
          endDate: toIso(l.endDate),
          reason: l.reason,
          type: l.type,
          status: l.status,
          approvedBy: l.approvedBy,
          deniedBy: l.deniedBy,
          denialReason: l.denialReason,
          endedEarlyAt: toIsoOrNull(l.endedEarlyAt),
          notificationsPaused: l.notificationsPaused,
          cooldownEndDate: toIsoOrNull(l.cooldownEndDate),
          announcementChannelId: l.announcementChannelId,
          announcementMessageId: l.announcementMessageId,
          createdAt: toIso(l.createdAt),
          updatedAt: toIso(l.updatedAt),
        })),
        roleAssignmentTracking: user.roleAssignmentTracking.map((r) => ({
          guildId: r.guildId,
          roleId: r.roleId,
          assignedAt: toIso(r.assignedAt),
          assignedBy: r.assignedBy,
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
          assignmentTrackingId: w.assignmentTrackingId,
          deliveryFailed: w.deliveryFailed,
          createdAt: toIso(w.createdAt),
        })),
        attendance: {
          asHost: user.hostAttendanceEvents.map(mapAttendanceEvent),
          asCohost: user.cohostAttendanceEvents.map(mapAttendanceEvent),
          asStaff: user.attendanceStaff.map((s) =>
            mapAttendanceEvent(s.event),
          ),
          asSquadMember: user.squadMemberships.map((m) => ({
            eventId: m.squad.event.id,
            date: toIso(m.squad.event.date),
            createdAt: toIso(m.squad.event.createdAt),
            squadName: m.squad.name,
            isLead: m.isLead,
            isLate: m.isLate,
            isSplit: m.isSplit,
            splitFrom: m.splitFrom,
            hasLeft: m.hasLeft,
          })),
          activeEventId: user.activeAttendanceEvent?.eventId ?? null,
        },
      }
    : emptyLinkedSections();

  const payload: UserExportPayload = {
    exportedAt: toIso(new Date()),
    userId: user?.id ?? null,
    discordId,
    ...linked,
    plannedEvents: plannedEvents.map((e) => {
      const roles: PlannedEventRole[] = [];
      if (e.hostId === discordId) roles.push("host");
      if (e.coHostId === discordId) roles.push("coHost");
      if (e.reviewedById === discordId) roles.push("reviewer");
      if (e.pendingCoHostUserId === discordId) roles.push("pendingCoHost");
      return {
        id: e.id,
        guildId: e.guildId,
        title: e.title,
        startTime: toIso(e.startTime),
        hostId: e.hostId,
        coHostId: e.coHostId,
        coHostOpen: e.coHostOpen,
        duty: e.duty,
        eventType: e.eventType,
        durationMinutes: e.durationMinutes,
        status: e.status,
        denialReason: e.denialReason,
        reviewedById: e.reviewedById,
        planningMessageId: e.planningMessageId,
        pendingCoHostUserId: e.pendingCoHostUserId,
        coHostRequestMessageId: e.coHostRequestMessageId,
        discordEventId: e.discordEventId,
        forceOverride: e.forceOverride,
        editResumeStatus: e.editResumeStatus,
        editSnapshot: e.editSnapshot,
        editStartedAt: toIsoOrNull(e.editStartedAt),
        createdAt: toIso(e.createdAt),
        updatedAt: toIso(e.updatedAt),
        roles,
      };
    }),
    cachedMessages: cachedMessages.map((m) => ({
      id: m.id,
      guildId: m.guildId,
      channelId: m.channelId,
      messageId: m.messageId,
      authorId: m.authorId,
      content: m.content,
      attachments: m.attachments,
      embeds: m.embeds,
      stickers: m.stickers,
      createdAt: toIso(m.createdAt),
      editedAt: toIsoOrNull(m.editedAt),
      expiresAt: toIso(m.expiresAt),
      updatedAt: toIso(m.updatedAt),
    })),
    modCases: modCases.map((c) => {
      const roles: ModCaseRole[] = [];
      if (c.targetId === discordId) roles.push("target");
      if (c.moderatorId === discordId) roles.push("moderator");
      if (c.claimedBy === discordId) roles.push("claimedBy");
      return {
        id: c.id,
        guildId: c.guildId,
        caseNumber: c.caseNumber,
        type: c.type,
        targetId: c.targetId,
        moderatorId: c.moderatorId,
        reason: c.reason,
        claimedBy: c.claimedBy,
        claimedReason: c.claimedReason,
        claimedAt: toIsoOrNull(c.claimedAt),
        logMessageId: c.logMessageId,
        logThreadId: c.logThreadId,
        expiresAt: toIsoOrNull(c.expiresAt),
        active: c.active,
        metadata: c.metadata,
        createdAt: toIso(c.createdAt),
        updatedAt: toIso(c.updatedAt),
        roles,
      };
    }),
    modUserNotes: modUserNotes.map((n) => {
      const roles: ModNoteRole[] = [];
      if (n.targetId === discordId) roles.push("target");
      if (n.authorId === discordId) roles.push("author");
      return {
        id: n.id,
        guildId: n.guildId,
        targetId: n.targetId,
        authorId: n.authorId,
        content: n.content,
        createdAt: toIso(n.createdAt),
        updatedAt: toIso(n.updatedAt),
        roles,
      };
    }),
    announcements: announcements.map((a) => ({
      id: a.id,
      content: a.content,
      createdAt: toIso(a.createdAt),
      createdBy: a.createdBy,
    })),
    spinTheBottleResponses: spinTheBottleResponses.map((r) => ({
      id: r.id,
      content: r.content,
      createdAt: toIso(r.createdAt),
      createdBy: r.createdBy,
    })),
    messagePurgeArchives: messagePurgeArchives.map((a) => ({
      id: a.id,
      guildId: a.guildId,
      channelId: a.channelId,
      moderatorId: a.moderatorId,
      messageCount: a.messageCount,
      logMessageId: a.logMessageId,
      logThreadId: a.logThreadId,
      caseId: a.caseId,
      createdAt: toIso(a.createdAt),
      expiresAt: toIso(a.expiresAt),
      updatedAt: toIso(a.updatedAt),
    })),
  };

  return payload;
}
