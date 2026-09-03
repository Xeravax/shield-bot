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
    const key = dayKey(zonedDate(event.startTime, timezone));
    const list = map.get(key) ?? [];
    list.push(event);
    map.set(key, list);
  }
  return map;
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
