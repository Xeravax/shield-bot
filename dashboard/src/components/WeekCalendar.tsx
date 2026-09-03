import type { MouseEvent } from "react";
import type { CalendarEvent } from "../api";
import {
  WEEKDAYS,
  addDays,
  eventStatusClass,
  formatClock,
  rangesOverlap,
  startOfWeek,
  zonedDate,
} from "../calendarUtils";

const HOUR_START = 8;
const HOUR_END = 24;
const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

interface ProposedSlot {
  start: Date;
  end: Date;
  title: string;
}

interface Props {
  weekStart: Date;
  onWeekChange: (weekStart: Date) => void;
  events: CalendarEvent[];
  timezone: string;
  proposed?: ProposedSlot | null;
  collidingIds?: Set<number>;
  onSelectSlot?: (local: Date) => void;
  onSelectEvent?: (event: CalendarEvent) => void;
}

export function WeekCalendar({
  weekStart,
  onWeekChange,
  events,
  timezone,
  proposed = null,
  collidingIds = new Set(),
  onSelectSlot,
  onSelectEvent,
}: Props) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hoursCount = HOUR_END - HOUR_START;

  function localParts(iso: string) {
    return zonedDate(iso, timezone);
  }

  function topPct(date: Date): number {
    const hours = date.getHours() + date.getMinutes() / 60;
    return ((hours - HOUR_START) / hoursCount) * 100;
  }

  function heightPct(start: Date, end: Date): number {
    const ms = Math.max(end.getTime() - start.getTime(), 30 * 60_000);
    return (ms / 3_600_000 / hoursCount) * 100;
  }

  function inWeek(date: Date): boolean {
    const end = addDays(weekStart, 7);
    return date >= weekStart && date < end;
  }

  function dayIndex(date: Date): number {
    const start = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((d.getTime() - start.getTime()) / 86_400_000);
  }

  function handleGridClick(day: Date, event: MouseEvent<HTMLDivElement>) {
    if (!onSelectSlot) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const ratio = Math.min(1, Math.max(0, y / rect.height));
    const hourFloat = HOUR_START + ratio * hoursCount;
    const hour = Math.floor(hourFloat);
    const minute = hourFloat % 1 >= 0.5 ? 30 : 0;
    const next = new Date(day);
    next.setHours(hour, minute, 0, 0);
    onSelectSlot(next);
  }

  const proposedCollides =
    proposed != null &&
    events.some((ev) =>
      rangesOverlap(
        proposed.start.getTime(),
        proposed.end.getTime(),
        new Date(ev.startTime).getTime(),
        new Date(ev.endTime).getTime(),
      ),
    );

  return (
    <div className="week-cal">
      <div className="month-cal-nav">
        <button
          type="button"
          className="btn secondary"
          onClick={() => onWeekChange(addDays(weekStart, -7))}
          aria-label="Previous week"
        >
          ←
        </button>
        <h3>
          {weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          {" – "}
          {addDays(weekStart, 6).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </h3>
        <div className="btn-row">
          <button
            type="button"
            className="btn secondary"
            onClick={() => onWeekChange(startOfWeek(new Date()))}
          >
            This week
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => onWeekChange(addDays(weekStart, 7))}
            aria-label="Next week"
          >
            →
          </button>
        </div>
      </div>

      <div className="week-cal-head">
        <div className="week-cal-gutter" />
        {days.map((day, i) => (
          <div key={day.toISOString()} className="week-cal-day-label">
            <span>{WEEKDAYS[i]}</span>
            <strong>{day.getDate()}</strong>
          </div>
        ))}
      </div>

      <div className="week-cal-body">
        <div className="week-cal-hours">
          {HOURS.map((h) => (
            <div key={h} className="week-cal-hour-label">
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        <div className="week-cal-grid">
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className="week-cal-col"
              onClick={(e) => handleGridClick(day, e)}
            >
              {HOURS.map((h) => (
                <div key={h} className="week-cal-slot" />
              ))}
            </div>
          ))}

          <div className="week-cal-overlay">
            {events.map((event) => {
              const start = localParts(event.startTime);
              const end = localParts(event.endTime);
              if (!inWeek(start)) {
                return null;
              }
              const col = dayIndex(start);
              if (col < 0 || col > 6) {
                return null;
              }
              const collide = collidingIds.has(event.id);
              return (
                <button
                  key={event.id}
                  type="button"
                  className={`week-cal-event ${eventStatusClass(event.status)}${event.duty === "OFF_DUTY" ? " offduty" : ""}${collide ? " collide" : ""}`}
                  style={{
                    left: `calc((100% / 7) * ${col} + 2px)`,
                    width: "calc(100% / 7 - 4px)",
                    top: `${topPct(start)}%`,
                    height: `${Math.max(heightPct(start, end), 4)}%`,
                  }}
                  title={`${event.title} · ${formatClock(event.startTime, timezone)} · ${event.status}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEvent?.(event);
                  }}
                >
                  {collide && <span className="week-cal-collide-layer" />}
                  <span className="week-cal-event-title">{event.title}</span>
                  <span className="week-cal-event-meta">
                    {formatClock(event.startTime, timezone)} · {event.status.toLowerCase()}
                  </span>
                </button>
              );
            })}

            {proposed && inWeek(proposed.start) && (
              <div
                className={`week-cal-event proposed${proposedCollides ? " collide" : ""}`}
                style={{
                  left: `calc((100% / 7) * ${dayIndex(proposed.start)} + 2px)`,
                  width: "calc(100% / 7 - 4px)",
                  top: `${topPct(proposed.start)}%`,
                  height: `${Math.max(heightPct(proposed.start, proposed.end), 4)}%`,
                }}
              >
                {proposedCollides && <span className="week-cal-collide-layer" />}
                <span className="week-cal-event-title">{proposed.title || "New event"}</span>
                <span className="week-cal-event-meta">proposed</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
