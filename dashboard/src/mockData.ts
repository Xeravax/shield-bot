import type {
  AdminOverview,
  CalendarEvent,
  CalendarSubscribeLinks,
  DashboardUser,
  MonthHours,
} from "./api";

export const MOCK_USER: DashboardUser = {
  id: "000000000000000000",
  username: "shield_deputy",
  globalName: "Sample Deputy",
  displayName: "Sample Deputy",
  avatarUrl: null,
  timezone: "America/New_York",
  timezoneStored: true,
  guildId: "000000000000000000",
  shieldMember: true,
  deputy: true,
  staff: true,
  host: true,
  hostLead: true,
  canForceSchedule: true,
  trainerTypes: ["emt", "cadet"],
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Sample patrol hours for the last N UTC months. */
export function mockMonthHours(count: number): MonthHours[] {
  const now = new Date();
  const samples = [4.5, 6.0, 8.5, 5.25, 7.0, 3.5, 9.0, 6.75, 4.0, 5.5, 8.0, 6.25];
  const rows: MonthHours[] = [];

  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    rows.push({
      year,
      month,
      label: `${MONTH_NAMES[month - 1]} ${year}`,
      hours: samples[(count - 1 - i) % samples.length],
      isCurrent: i === 0,
    });
  }

  return rows;
}

/** Sample published (exported) events around the current date. */
export function mockCalendarEvents(): CalendarEvent[] {
  const now = Date.now();
  const day = 86_400_000;

  function event(
    id: number,
    title: string,
    offsetDays: number,
    hour: number,
    duty: "ON_DUTY" | "OFF_DUTY",
    durationMinutes = 120,
  ): CalendarEvent {
    const start = new Date(now + offsetDays * day);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    return {
      id,
      title,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      hostId: MOCK_USER.id,
      coHostId: null,
      duty,
      eventType: duty === "ON_DUTY" ? "PATROL" : "GAME",
      durationMinutes,
      status: "PUBLISHED",
    };
  }

  return [
    event(9001, "Tuesday Patrol Event", 2, 20, "ON_DUTY"),
    event(9003, "Community Game Night", 8, 18, "OFF_DUTY", 180),
    event(9004, "Saturday Patrol Event", -3, 20, "ON_DUTY"),
    event(9005, "Special Operations Event", -10, 21, "ON_DUTY", 180),
  ];
}

export function mockCalendarLinks(): CalendarSubscribeLinks {
  const icsUrl = "https://api.vrcshield.com/api/events/000000000000000000/calendar.ics";
  const webcalUrl = icsUrl.replace(/^https:/i, "webcal:");
  return {
    icsUrl,
    webcalUrl,
    googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(icsUrl)}`,
    appleUrl: webcalUrl,
  };
}

export function mockAdminOverview(): AdminOverview {
  const now = new Date();
  return {
    recruitPlus: 142,
    deputyPlus: 86,
    pendingEventsThisWeek: 3,
    draftEvents: 2,
    openLoas: 4,
    activePatrolSessions: 5,
    recentCases: [
      {
        id: 1,
        caseNumber: 1042,
        type: "WARN",
        targetId: "111111111111111111",
        moderatorId: "222222222222222222",
        reason: "Sample warning — inappropriate language in patrol channel",
        createdAt: new Date(now.getTime() - 2 * 86_400_000).toISOString(),
      },
      {
        id: 2,
        caseNumber: 1041,
        type: "NOTE",
        targetId: "333333333333333333",
        moderatorId: "222222222222222222",
        reason: "Sample staff note for review",
        createdAt: new Date(now.getTime() - 5 * 86_400_000).toISOString(),
      },
    ],
  };
}
