import { useEffect, useMemo, useState } from "react";
import {
  fetchEvents,
  type CalendarEvent,
  type CalendarSubscribeLinks,
  type DashboardUser,
} from "../api";
import {
  dayKey,
  eventsByDay,
  formatClock,
  sameDay,
  spanOccupiedDays,
  startOfMonth,
  zonedDate,
} from "../calendarUtils";
import { openExternalLink } from "../discord";
import { mockCalendarEvents, mockCalendarLinks } from "../mockData";
import { MonthCalendar } from "./MonthCalendar";
import { PreviewNotice } from "./PreviewNotice";

interface Props {
  token: string;
  user: DashboardUser;
  preview?: boolean;
}

export function CalendarPanel({ token, user, preview = false }: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendar, setCalendar] = useState<CalendarSubscribeLinks | null>(null);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState<string | null>(null);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());

  const range = useMemo(() => {
    const from = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
    const to = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 2, 0, 23, 59, 59);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [viewMonth]);

  useEffect(() => {
    if (!user.shieldMember || preview || !token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchEvents(token, range.from, range.to)
      .then((data) => {
        setEvents(data.events);
        setCalendar(data.calendar);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, range.from, range.to, user.shieldMember, preview]);

  if (!user.shieldMember) {
    return null;
  }

  const isPreview = preview || loading;
  const displayEvents = isPreview ? mockCalendarEvents() : events;
  const links = calendar ?? mockCalendarLinks();
  const byDay = eventsByDay(displayEvents, user.timezone);
  const selectedEvents = byDay.get(dayKey(selectedDay)) ?? [];

  return (
    <section className={`dossier calendar-panel${isPreview ? " preview" : ""}`}>
      <div className="dossier-head">
        <div>
          <h2>Duty board</h2>
          <p>Published Discord events for the month.</p>
        </div>
        <div className="btn-row calendar-subscribe">
          <button
            type="button"
            className="btn secondary"
            onClick={() => void openExternalLink(links.googleUrl)}
          >
            Google
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void openExternalLink(links.appleUrl)}
          >
            Apple
          </button>
        </div>
      </div>

      {isPreview && <PreviewNotice />}
      {error && !isPreview && (
        <p style={{ color: "var(--danger)" }}>{error}</p>
      )}

      <div className="calendar-layout">
        <MonthCalendar
          viewMonth={viewMonth}
          onViewMonthChange={(month) => {
            setViewMonth(month);
            if (!sameDay(selectedDay, month) && selectedDay.getMonth() !== month.getMonth()) {
              setSelectedDay(new Date(month));
            }
          }}
          events={displayEvents}
          timezone={user.timezone}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          selectable
        />

        <div className="day-detail">
          <h3>
            {selectedDay.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </h3>
          {selectedEvents.length === 0 ? (
            <p>No published events this day.</p>
          ) : (
            <ul className="event-list">
              {selectedEvents.map((event) => {
                const startLocal = zonedDate(event.startTime, user.timezone);
                const endLocal = zonedDate(event.endTime, user.timezone);
                const occupied = spanOccupiedDays(startLocal, endLocal);
                const firstKey = dayKey(occupied[0]);
                const lastKey = dayKey(occupied[occupied.length - 1]);
                const selectedKey = dayKey(selectedDay);
                const spanNote =
                  firstKey !== selectedKey
                    ? " · continues from prior day"
                    : lastKey !== selectedKey
                      ? " · continues into next day"
                      : "";
                return (
                <li
                  key={event.id}
                  className={`event-item ${event.duty === "OFF_DUTY" ? "offduty" : ""}`}
                >
                  <span className="event-accent" />
                  <div>
                    <div className="event-title">{event.title}</div>
                    <div className="event-meta">
                      {formatClock(event.startTime, user.timezone)}
                      {" – "}
                      {formatClock(event.endTime, user.timezone)} ·{" "}
                      {event.duty === "ON_DUTY" ? "On-duty" : "Off-duty"}
                      {spanNote}
                    </div>
                  </div>
                  <span className="badge approved">Live</span>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
