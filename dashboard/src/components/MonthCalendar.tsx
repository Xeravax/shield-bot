import type { CalendarEvent } from "../api";
import {
  WEEKDAYS,
  addMonths,
  buildMonthCells,
  dayKey,
  eventsByDay,
  eventStatusClass,
  formatClock,
  formatMonthTitle,
  sameDay,
  startOfMonth,
} from "../calendarUtils";

interface Props {
  viewMonth: Date;
  onViewMonthChange: (month: Date) => void;
  events: CalendarEvent[];
  timezone: string;
  selectedDay?: Date | null;
  onSelectDay?: (day: Date) => void;
  selectable?: boolean;
}

export function MonthCalendar({
  viewMonth,
  onViewMonthChange,
  events,
  timezone,
  selectedDay = null,
  onSelectDay,
  selectable = false,
}: Props) {
  const cells = buildMonthCells(viewMonth);
  const byDay = eventsByDay(events, timezone);
  const today = new Date();
  const month = viewMonth.getMonth();

  return (
    <div className="month-cal">
      <div className="month-cal-nav">
        <button
          type="button"
          className="btn secondary"
          onClick={() => onViewMonthChange(addMonths(viewMonth, -1))}
          aria-label="Previous month"
        >
          ←
        </button>
        <h3>{formatMonthTitle(viewMonth)}</h3>
        <div className="btn-row">
          <button
            type="button"
            className="btn secondary"
            onClick={() => onViewMonthChange(startOfMonth(new Date()))}
          >
            Today
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => onViewMonthChange(addMonths(viewMonth, 1))}
            aria-label="Next month"
          >
            →
          </button>
        </div>
      </div>

      <div className="month-cal-weekdays">
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="month-cal-grid">
        {cells.map((day) => {
          const key = dayKey(day);
          const dayEvents = byDay.get(key) ?? [];
          const inMonth = day.getMonth() === month;
          const isToday = sameDay(day, today);
          const isSelected = selectedDay ? sameDay(day, selectedDay) : false;
          const className = [
            "month-cal-day",
            inMonth ? "" : "outside",
            isToday ? "today" : "",
            isSelected ? "selected" : "",
            dayEvents.length > 0 ? "has-events" : "",
            selectable ? "selectable" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={key}
              type="button"
              className={className}
              onClick={() => onSelectDay?.(day)}
            >
              <span className="month-cal-date">{day.getDate()}</span>
              <div className="month-cal-events">
                {dayEvents.slice(0, 4).map((event) => (
                  <span
                    key={event.id}
                    className={`month-cal-dot ${event.duty === "OFF_DUTY" ? "offduty" : "onduty"} ${eventStatusClass(event.status)}`}
                    title={`${event.title} · ${formatClock(event.startTime, timezone)}`}
                  />
                ))}
                {dayEvents.length > 4 && (
                  <span className="month-cal-more">+{dayEvents.length - 4}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
