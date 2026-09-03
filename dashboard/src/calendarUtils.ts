import type { CalendarEvent } from "./api";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Monday-first calendar cells for a month (includes leading/trailing days).
 *  Trailing rows that are entirely outside the current month are trimmed,
 *  so a 5-week month renders 5 rows instead of always 6. */
export function buildMonthCells(viewMonth: Date): Date[] {
  const first = startOfMonth(viewMonth);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - mondayOffset);

  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }

  // Drop the last row if every cell in it is outside the view month
  const month = viewMonth.getMonth();
  while (cells.length > 7) {
    const lastRow = cells.slice(-7);
    if (lastRow.every((d) => d.getMonth() !== month)) {
      cells.splice(-7);
    } else {
      break;
    }
  }

  return cells;
}

export function eventsByDay(
  events: CalendarEvent[],
  timezone: string,
): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    for (const day of eventOccupiedDays(event, timezone)) {
      const key = dayKey(day);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
  }
  return map;
}

/** Calendar days this event occupies (local timezone). Midnight-exact ends do not include the end day. */
export function eventOccupiedDays(event: CalendarEvent, timezone: string): Date[] {
  return spanOccupiedDays(
    zonedDate(event.startTime, timezone),
    zonedDate(event.endTime, timezone),
  );
}

export function spanOccupiedDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  // Exact midnight end means the event finished at the start of that day.
  if (
    end.getHours() === 0 &&
    end.getMinutes() === 0 &&
    end.getSeconds() === 0 &&
    end.getMilliseconds() === 0 &&
    last.getTime() > cursor.getTime()
  ) {
    last = addDays(last, -1);
  }
  if (last.getTime() < cursor.getTime()) {
    last = new Date(cursor);
  }
  while (cursor.getTime() <= last.getTime()) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** Split a local start/end into per-day segments for week/day grids. */
export function daySegments(
  start: Date,
  end: Date,
): Array<{ day: Date; start: Date; end: Date; continuesFromPrev: boolean; continuesToNext: boolean }> {
  const occupied = spanOccupiedDays(start, end);
  return occupied.map((day, index) => {
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
    const dayEnd = addDays(dayStart, 1);
    const segStart = index === 0 ? start : dayStart;
    const segEnd = end.getTime() < dayEnd.getTime() ? end : dayEnd;
    return {
      day,
      start: segStart,
      end: segEnd.getTime() > segStart.getTime() ? segEnd : new Date(segStart.getTime() + 30 * 60_000),
      continuesFromPrev: index > 0,
      continuesToNext: index < occupied.length - 1,
    };
  });
}

export function zonedDate(iso: string, timezone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(new Date(iso));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? "0");
    return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  } catch {
    return new Date(iso);
  }
}

export function formatMonthTitle(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function formatClock(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleTimeString();
  }
}

export function formatNaturalDayTime(date: Date, hour: number, minute: number): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${months[date.getMonth()]} ${date.getDate()} ${date.getFullYear()} ${hh}:${mm}`;
}

export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, delta: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}

export function eventStatusClass(status: string): string {
  const s = status.toUpperCase();
  if (s === "PENDING") return "pending";
  if (s === "DRAFT") return "draft";
  if (s === "DENIED") return "denied";
  if (s === "APPROVED") return "approved";
  return "published";
}
