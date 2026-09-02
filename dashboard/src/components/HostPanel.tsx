import { useEffect, useMemo, useState } from "react";
import {
  createHostEvent,
  fetchEvents,
  HANDBOOK_LINKS,
  setTimezone,
  validateHostEvent,
  type CalendarEvent,
  type DashboardUser,
  type EventRuleResult,
} from "../api";
import {
  dayKey,
  eventsByDay,
  formatClock,
  formatNaturalDayTime,
  startOfMonth,
} from "../calendarUtils";
import { mockCalendarEvents } from "../mockData";
import { ExternalLink } from "./HandbookSection";
import { MonthCalendar } from "./MonthCalendar";
import { PreviewNotice } from "./PreviewNotice";

interface Props {
  token: string;
  user: DashboardUser;
  preview?: boolean;
  onTimezoneSaved: (timezone: string) => void;
}

export function HostPanel({
  token,
  user,
  preview = false,
  onTimezoneSaved,
}: Props) {
  const [tzInput, setTzInput] = useState(user.timezone);
  const [title, setTitle] = useState("");
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [clock, setClock] = useState("20:00");
  const [duty, setDuty] = useState<"ON_DUTY" | "OFF_DUTY">("ON_DUTY");
  const [duration, setDuration] = useState(120);
  const [eventType, setEventType] = useState("");
  const [rules, setRules] = useState<EventRuleResult[]>([]);
  const [blocking, setBlocking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  const range = useMemo(() => {
    const from = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
    const to = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 2, 0, 23, 59, 59);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [viewMonth]);

  useEffect(() => {
    if (preview || !token || !user.timezoneStored) {
      return;
    }
    fetchEvents(token, range.from, range.to)
      .then((data) => setEvents(data.events))
      .catch(() => setEvents([]));
  }, [token, range.from, range.to, preview, user.timezoneStored]);

  async function saveTimezone() {
    if (preview) {
      return;
    }
    setError(null);
    try {
      const result = await setTimezone(token, tzInput.trim());
      onTimezoneSaved(result.timezone);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save timezone");
    }
  }

  if (!user.timezoneStored) {
    return (
      <div className="panel">
        <section className="surface" style={{ maxWidth: 520 }}>
          <div className="surface-head">
            <div>
              <h2>Set your timezone</h2>
              <p>
                Required before scheduling so collision checks match your local
                clock.
              </p>
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="tz">IANA timezone, offset, or abbreviation</label>
            <input
              id="tz"
              value={tzInput}
              onChange={(e) => setTzInput(e.target.value)}
              placeholder="America/New_York"
            />
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => void saveTimezone()}
          >
            Save timezone
          </button>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        </section>
      </div>
    );
  }

  const displayEvents = preview ? mockCalendarEvents() : events;
  const dayEvents = eventsByDay(displayEvents, user.timezone).get(dayKey(selectedDay)) ?? [];

  function buildTimeString(): string {
    const [hourRaw, minuteRaw] = clock.split(":");
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    return formatNaturalDayTime(
      selectedDay,
      Number.isFinite(hour) ? hour : 20,
      Number.isFinite(minute) ? minute : 0,
    );
  }

  function eventBody() {
    return {
      title,
      time: buildTimeString(),
      duty,
      durationMinutes: duration,
      eventType: eventType || undefined,
      force: false,
    };
  }

  async function checkCollision() {
    if (preview) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await validateHostEvent(token, eventBody());
      setRules(result.results);
      setBlocking(result.blocking);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitEvent() {
    if (preview) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const validation = await validateHostEvent(token, eventBody());
      if (validation.blocking) {
        setRules(validation.results);
        setBlocking(true);
        setError("Fix blocking issues before submitting.");
        return;
      }
      const result = await createHostEvent(token, eventBody());
      setRules(result.validation.results);
      setMessage(
        `Draft event #${result.eventId} created. Submit it in Discord with /event submit when ready.`,
      );
      setTitle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create event");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel host-grid">
      <section className={`surface${preview ? " preview" : ""}`}>
        <div className="surface-head">
          <div>
            <h2>Schedule event</h2>
            <p>
              Pick a day on the calendar, then set the local time (
              <strong>{user.timezone}</strong>).
            </p>
          </div>
        </div>
        {preview && (
          <PreviewNotice message="Event scheduling unavailable in sample mode." />
        )}

        <MonthCalendar
          viewMonth={viewMonth}
          onViewMonthChange={setViewMonth}
          events={displayEvents}
          timezone={user.timezone}
          selectedDay={selectedDay}
          onSelectDay={(day) => {
            setSelectedDay(day);
            setViewMonth(startOfMonth(day));
          }}
          selectable
        />

        <div className="day-detail" style={{ marginTop: "1rem" }}>
          <h3>
            {selectedDay.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </h3>
          {dayEvents.length > 0 ? (
            <ul className="event-list">
              {dayEvents.map((event) => (
                <li
                  key={event.id}
                  className={`event-item ${event.duty === "OFF_DUTY" ? "offduty" : ""}`}
                >
                  <span className="event-accent" />
                  <div>
                    <div className="event-title">{event.title}</div>
                    <div className="event-meta">
                      {formatClock(event.startTime, user.timezone)} –{" "}
                      {formatClock(event.endTime, user.timezone)} · published
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p>No published events on this day.</p>
          )}
        </div>
      </section>

      <section className={`surface${preview ? " preview" : ""}`}>
        <div className="surface-head">
          <div>
            <h2>Event details</h2>
            <p>
              Starts{" "}
              <strong>
                {selectedDay.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}{" "}
                at {clock}
              </strong>
            </p>
          </div>
        </div>

        <div className="form-row">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Patrol Event"
            disabled={preview}
          />
        </div>
        <div className="form-row">
          <label htmlFor="clock">Start time (local)</label>
          <input
            id="clock"
            type="time"
            value={clock}
            onChange={(e) => setClock(e.target.value)}
            disabled={preview}
          />
        </div>
        <div className="form-row">
          <label htmlFor="duty">Duty</label>
          <select
            id="duty"
            value={duty}
            onChange={(e) =>
              setDuty(e.target.value as "ON_DUTY" | "OFF_DUTY")
            }
            disabled={preview}
          >
            <option value="ON_DUTY">On-duty</option>
            <option value="OFF_DUTY">Off-duty</option>
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="duration">Duration (minutes)</label>
          <select
            id="duration"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            disabled={preview}
          >
            {duty === "ON_DUTY" ? (
              <>
                <option value={120}>2 hours</option>
                <option value={180}>3 hours</option>
              </>
            ) : (
              <>
                <option value={60}>1 hour</option>
                <option value={120}>2 hours</option>
                <option value={180}>3 hours</option>
              </>
            )}
          </select>
        </div>
        <div className="form-row">
          <label htmlFor="etype">Event type (optional)</label>
          <select
            id="etype"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            disabled={preview}
          >
            <option value="">Auto</option>
            <option value="PATROL">Patrol</option>
            <option value="GAME">Game</option>
            <option value="SPECIAL">Special</option>
            <option value="RECRUITMENT">Recruitment</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        <div className="btn-row">
          <button
            type="button"
            className="btn secondary"
            disabled={preview || busy}
            onClick={() => void checkCollision()}
          >
            Check collisions
          </button>
          <button
            type="button"
            className="btn"
            disabled={preview || busy}
            onClick={() => void submitEvent()}
          >
            Create draft
          </button>
        </div>

        {rules.length > 0 && (
          <ul className="rule-list">
            {rules.map((r) => (
              <li key={r.id} className={`rule-item ${r.severity}`}>
                <strong>{r.label}:</strong> {r.message}
              </li>
            ))}
          </ul>
        )}
        {blocking && (
          <p style={{ color: "var(--danger)" }}>
            Blocking rule failures must be resolved before submitting.
          </p>
        )}
        {message && <p style={{ color: "var(--ok)" }}>{message}</p>}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

        <div style={{ marginTop: "1.25rem" }}>
          <h3 style={{ margin: "0 0 0.65rem", color: "var(--gold)" }}>
            Hosting guides
          </h3>
          <div className="resource-grid">
            <ExternalLink href={HANDBOOK_LINKS.hosting101}>
              Event Hosting 101
            </ExternalLink>
            <ExternalLink href={HANDBOOK_LINKS.attendance}>
              Attendance System
            </ExternalLink>
            <ExternalLink href={HANDBOOK_LINKS.scheduling}>
              Event Scheduling System
            </ExternalLink>
          </div>
        </div>
      </section>
    </div>
  );
}
