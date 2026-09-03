export interface DashboardUser {
  id: string;
  username: string;
  globalName: string | null;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
  timezoneStored: boolean;
  guildId: string;
  shieldMember: boolean;
  deputy: boolean;
  staff: boolean;
  host: boolean;
  hostLead: boolean;
  canForceSchedule: boolean;
  trainerTypes: ("emt" | "tru" | "cadet")[];
}

export interface MonthHours {
  year: number;
  month: number;
  label: string;
  hours: number;
  isCurrent: boolean;
}

export interface CalendarEvent {
  id: number;
  title: string;
  startTime: string;
  endTime: string;
  hostId: string;
  coHostId: string | null;
  duty: string;
  eventType: string | null;
  durationMinutes: number;
  status: string;
  denialReason?: string | null;
  published?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
}

export interface EventRuleResult {
  id: string;
  label: string;
  severity: "pass" | "fail" | "warning";
  message: string;
}

export interface AdminOverview {
  pendingEventsThisWeek: number;
  draftEvents: number;
  openLoas: number;
  activePatrolSessions: number;
  monthLabel: string;
  monthHoursTotal: number;
  hoursMembers: Array<{
    userId: string;
    displayName: string;
    hours: number;
  }>;
  activePatrols: Array<{
    userId: string;
    displayName: string;
    startedAt: string;
    channelId: string;
  }>;
  recentCases: Array<{
    id: number;
    caseNumber: number;
    type: string;
    targetId: string;
    moderatorId: string;
    reason: string | null;
    createdAt: string;
    staffLogUrl: string | null;
  }>;
}

export interface ModlogCase {
  id: number;
  caseNumber: number;
  type: string;
  targetId: string;
  moderatorId: string;
  reason: string | null;
  claimedBy: string | null;
  active: boolean;
  createdAt: string;
}

export interface ModlogNote {
  id: number;
  authorId: string;
  content: string;
  createdAt: string;
}

const API_BASE = "/api/dashboard";

// API calls must stay relative so Discord’s discordsays.com proxy can forward
// /api → api.vrcshield.com/api. Never use https://dashboard.vrcshield.com here.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function apiFetch<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message);
  }

  return (await res.json()) as T;
}

export async function exchangeToken(code: string): Promise<string> {
  const res = await fetch(`${API_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, "Token exchange failed");
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export function fetchMe(token: string) {
  return apiFetch<DashboardUser>("/me", token);
}

export function fetchHours(token: string, months: number) {
  return apiFetch<{ months: MonthHours[] }>(`/hours?months=${months}`, token);
}

export interface CalendarSubscribeLinks {
  icsUrl: string;
  webcalUrl: string;
  googleUrl: string;
  appleUrl: string;
}

export function fetchEvents(
  token: string,
  from: string,
  to: string,
  opts?: { planning?: boolean },
) {
  const params = new URLSearchParams({ from, to });
  if (opts?.planning) {
    params.set("planning", "1");
  }
  return apiFetch<{ events: CalendarEvent[]; calendar: CalendarSubscribeLinks }>(
    `/events?${params.toString()}`,
    token,
  );
}

export function setTimezone(token: string, timezone: string) {
  return apiFetch<{ timezone: string; timezoneStored: boolean }>(
    "/me/timezone",
    token,
    { method: "PUT", body: JSON.stringify({ timezone }) },
  );
}

export function validateHostEvent(
  token: string,
  body: Record<string, unknown>,
) {
  return apiFetch<{
    startTime: string;
    results: EventRuleResult[];
    overriddenIds: string[];
    blocking: boolean;
  }>("/host/events/validate", token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createHostEvent(token: string, body: Record<string, unknown>) {
  return apiFetch<{
    eventId: number;
    startTime: string;
    validation: { results: EventRuleResult[]; overriddenIds: string[] };
  }>("/host/events", token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function fetchHostEvents(token: string) {
  return apiFetch<{
    hostLead: boolean;
    canForceSchedule: boolean;
    events: CalendarEvent[];
  }>("/host/events", token);
}

export function updateHostEvent(
  token: string,
  eventId: number,
  body: Record<string, unknown>,
) {
  return apiFetch<{
    eventId: number;
    startTime: string;
    status: string;
    validation: { results: EventRuleResult[]; overriddenIds: string[] };
  }>(`/host/events/${eventId}`, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteHostEvent(token: string, eventId: number) {
  try {
    return await apiFetch<{ ok: boolean; message: string }>(
      `/host/events/${eventId}`,
      token,
      { method: "DELETE" },
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
      return apiFetch<{ ok: boolean; message: string }>(
        `/host/events/${eventId}/delete`,
        token,
        { method: "POST" },
      );
    }
    throw error;
  }
}

export function fetchAdminOverview(token: string) {
  return apiFetch<AdminOverview>("/admin/overview", token);
}

export function fetchAdminHours(
  token: string,
  userId: string,
  year?: number,
  month?: number,
) {
  const params = new URLSearchParams();
  if (year) params.set("year", String(year));
  if (month) params.set("month", String(month));
  const q = params.toString();
  return apiFetch<{
    userId: string;
    year: number;
    month: number;
    label: string;
    hours: number;
    allTimeHours: number;
  }>(`/admin/hours/${userId}${q ? `?${q}` : ""}`, token);
}

export function adjustAdminHours(
  token: string,
  userId: string,
  deltaMs: number,
  year?: number,
  month?: number,
) {
  return apiFetch<{ userId: string; year: number; month: number; hours: number }>(
    `/admin/hours/${userId}`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ deltaMs, year, month }),
    },
  );
}

export function fetchModlogs(token: string, userId: string) {
  return apiFetch<{ cases: ModlogCase[]; notes: ModlogNote[] }>(
    `/admin/modlogs/${userId}`,
    token,
  );
}

export const SITE_LINKS = {
  guides: "https://guides.vrcshield.com",
  main: "https://vrcshield.com",
} as const;

export const HANDBOOK_LINKS = {
  fullHandbook:
    "https://guides.vrcshield.com/books/shield-handbook/page/full-handbook",
  phantomPain:
    "https://guides.vrcshield.com/books/phantom-pain/page/phantom-pain-list",
  avatarGuidelines:
    "https://guides.vrcshield.com/books/avatar-guidelines/page/2026",
  staffTraining:
    "https://guides.vrcshield.com/books/staff-team/page/training-handbook",
  hosting101:
    "https://guides.vrcshield.com/books/event-hosting/page/event-hosting-101",
  attendance:
    "https://guides.vrcshield.com/books/event-hosting/page/attendance-system",
  scheduling:
    "https://guides.vrcshield.com/books/event-hosting/page/event-scheduling-system",
  emtTrainer: "https://guides.vrcshield.com/books/emt?shelf=7",
  truTrainer: "https://guides.vrcshield.com/books/tru?shelf=7",
  cadetTrainer:
    "https://guides.vrcshield.com/books/cadet-training/page/trainer-handbook",
} as const;
