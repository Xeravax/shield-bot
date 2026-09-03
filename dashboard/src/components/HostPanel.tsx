import { useEffect, useMemo, useState } from "react";
import {
  createHostEvent,
  fetchEvents,
  fetchHostEvents,
  HANDBOOK_LINKS,
  setTimezone,
  updateHostEvent,
  validateHostEvent,
  type CalendarEvent,
  type DashboardUser,
  type EventRuleResult,
} from "../api";
import {
  formatClock,
  formatNaturalDayTime,
  startOfMonth,
  zonedDate,
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

function defaultDatetimeLocal(timezone: string): string {
  const now = zonedDate(new Date().toISOString(), timezone);
  now.setMinutes(0, 0, 0);
  now.setHours(20);
  if (now.getTime() < Date.now()) {
    now.setDate(now.getDate() + 1);
  }
  return toDatetimeLocal(now);
}

function toDatetimeLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function naturalFromDatetimeLocal(value: string): string {
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = (timePart ?? "20:00").split(":").map(Number);
  return formatNaturalDayTime(
    new Date(y, m - 1, d),
    Number.isFinite(hh) ? hh : 20,
    Number.isFinite(mm) ? mm : 0,
  );
}

function shiftDays(base: string, days: number, hour = 20): string {
  const [datePart] = base.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const date = new Date(y, m - 1, d + days, hour, 0, 0, 0);
  return toDatetimeLocal(date);
}

export function HostPanel({
  token,
  user,
  preview = false,
  onTimezoneSaved,
}: Props) {
  const [tzInput, setTzInput] = useState(user.timezone);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(() =>
    defaultDatetimeLocal(user.timezone),
  );
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [duty, setDuty] = useState<"ON_DUTY" | "OFF_DUTY">("ON_DUTY");
  const [duration, setDuration] = useState(120);
  const [eventType, setEventType] = useState("");
  const [force, setForce] = useState(false);
  const [rules, setRules] = useState<EventRuleResult[]>([]);
  const [blocking, setBlocking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<CalendarEvent[]>([]);
  const [managed, setManaged] = useState<CalendarEvent[]>([]);
  const [hostSection, setHostSection] = useState<
    "schedule" | "queue" | "board"
  >("schedule");

  const range = useMemo(() => {
    const from = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
    const to = new Date(
      viewMonth.getFullYear(),
      viewMonth.getMonth() + 2,
      0,
      23,
      59,
      59,
    );
    return { from: from.toISOString(), to: to.toISOString() };
  }, [viewMonth]);

  async function refreshManaged() {
    if (preview || !token) {
      return;
    }
    try {
      const data = await fetchHostEvents(token);
      setManaged(data.events);
    } catch {
      setManaged([]);
    }
  }

  useEffect(() => {
    if (preview || !token || !user.timezoneStored) {
      return;
    }
    fetchEvents(token, range.from, range.to)
      .then((data) => setPublished(data.events))
      .catch(() => setPublished([]));
    void refreshManaged();
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
        <section className="dossier" style={{ maxWidth: 520 }}>
          <div className="dossier-head">
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

  const displayPublished = preview ? mockCalendarEvents() : published;

  function eventBody() {
    return {
      title,
      time: naturalFromDatetimeLocal(startsAt),
      duty,
      durationMinutes: duration,
      eventType: eventType || undefined,
      force: force && user.canForceSchedule,
    };
  }

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setStartsAt(defaultDatetimeLocal(user.timezone));
    setDuty("ON_DUTY");
    setDuration(120);
    setEventType("");
    setForce(false);
    setRules([]);
    setBlocking(false);
  }

  function loadEventIntoForm(event: CalendarEvent) {
    const local = zonedDate(event.startTime, user.timezone);
    setEditingId(event.id);
    setTitle(event.title);
    setStartsAt(toDatetimeLocal(local));
    setDuty(event.duty === "OFF_DUTY" ? "OFF_DUTY" : "ON_DUTY");
    setDuration(event.durationMinutes);
    setEventType(event.eventType ?? "");
    setMessage(null);
    setError(null);
    setRules([]);
    setHostSection("schedule");
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
      if (editingId != null) {
        const result = await updateHostEvent(token, editingId, eventBody());
        setRules(result.validation.results);
        setMessage(`Updated draft #${result.eventId}.`);
      } else {
        const result = await createHostEvent(token, eventBody());
        setRules(result.validation.results);
        setMessage(
          `Draft event #${result.eventId} created. Submit it in Discord with /event submit when ready.`,
        );
      }
      resetForm();
      await refreshManaged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save event");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel folder-shell">
      <nav className="folder-rail" aria-label="Host sections">
        <button
          type="button"
          className={`folder-rail-tab folder-rail-schedule${hostSection === "schedule" ? " active" : ""}`}
          onClick={() => setHostSection("schedule")}
        >
          <span className="folder-rail-label">Schedule</span>
          <span className="folder-rail-hint">Submit for roster</span>
        </button>
        <button
          type="button"
          className={`folder-rail-tab folder-rail-queue${hostSection === "queue" ? " active" : ""}`}
          onClick={() => setHostSection("queue")}
        >
          <span className="folder-rail-label">Queue</span>
          <span className="folder-rail-hint">Your drafts</span>
        </button>
        <button
          type="button"
          className={`folder-rail-tab folder-rail-board${hostSection === "board" ? " active" : ""}`}
          onClick={() => setHostSection("board")}
        >
          <span className="folder-rail-label">Board</span>
          <span className="folder-rail-hint">Published + guides</span>
        </button>
      </nav>

      <div className="folder-stage">
        {hostSection === "schedule" && (
          <section className={`dossier${preview ? " preview" : ""}`}>
            <div className="dossier-head">
              <div>
                <h2>
                  {editingId != null ? "Edit roster entry" : "Submit for roster"}
                </h2>
                <p>
                  Pick a start date &amp; time in{" "}
                  <strong>{user.timezone}</strong>.
                  {user.hostLead
                    ? " Team lead: you can edit any pending draft."
                    : " You can edit your own drafts and pending events."}
                </p>
              </div>
            </div>
            {preview && (
              <PreviewNotice message="Event scheduling unavailable in sample mode." />
            )}

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
              <label htmlFor="starts">Starts at (local)</label>
              <input
                id="starts"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                disabled={preview}
              />
              <div className="chip-row" style={{ marginTop: "0.5rem" }}>
                <button
                  type="button"
                  className="chip"
                  disabled={preview}
                  onClick={() =>
                    setStartsAt(defaultDatetimeLocal(user.timezone))
                  }
                >
                  Tonight 20:00
                </button>
                <button
                  type="button"
                  className="chip"
                  disabled={preview}
                  onClick={() =>
                    setStartsAt(
                      shiftDays(defaultDatetimeLocal(user.timezone), 1),
                    )
                  }
                >
                  Tomorrow 20:00
                </button>
                <button
                  type="button"
                  className="chip"
                  disabled={preview}
                  onClick={() => {
                    const base = new Date();
                    const day = base.getDay();
                    const add = (7 - day) % 7 || 7;
                    setStartsAt(shiftDays(toDatetimeLocal(base), add, 20));
                  }}
                >
                  Next Sunday 20:00
                </button>
              </div>
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

            {user.canForceSchedule && (
              <label className="force-toggle">
                <input
                  type="checkbox"
                  checked={force}
                  disabled={preview}
                  onChange={(e) => setForce(e.target.checked)}
                />
                <span>
                  Force schedule (bypass week / collision rules — team lead)
                </span>
              </label>
            )}

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
                disabled={preview || busy || !title.trim()}
                onClick={() => void submitEvent()}
              >
                {editingId != null ? "Save changes" : "Create draft"}
              </button>
              {editingId != null && (
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={resetForm}
                >
                  Cancel edit
                </button>
              )}
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
          </section>
        )}

        {hostSection === "queue" && (
          <section className={`dossier${preview ? " preview" : ""}`}>
            <div className="dossier-head">
              <div>
                <h2>Your queue</h2>
                <p>
                  {user.hostLead
                    ? "All draft / pending / denied events."
                    : "Your draft, pending, and denied events."}
                </p>
              </div>
            </div>
            {managed.length === 0 ? (
              <p>No events in the queue.</p>
            ) : (
              <ul className="event-list">
                {managed.map((event) => (
                  <li
                    key={event.id}
                    className={`event-item ${event.duty === "OFF_DUTY" ? "offduty" : ""} ${event.status === "DENIED" ? "pending" : ""}`}
                  >
                    <span className="event-accent" />
                    <div>
                      <div className="event-title">{event.title}</div>
                      <div className="event-meta">
                        {formatClock(event.startTime, user.timezone)} ·{" "}
                        {event.status.toLowerCase()}
                        {event.denialReason ? ` — ${event.denialReason}` : ""}
                      </div>
                    </div>
                    {event.canEdit !== false && (
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={preview}
                        onClick={() => loadEventIntoForm(event)}
                      >
                        Edit
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {hostSection === "board" && (
          <>
            <section className={`dossier${preview ? " preview" : ""}`}>
              <div className="dossier-head">
                <div>
                  <h2>Published calendar</h2>
                  <p>Read-only view of live Discord events (for conflicts).</p>
                </div>
              </div>
              <MonthCalendar
                viewMonth={viewMonth}
                onViewMonthChange={setViewMonth}
                events={displayPublished}
                timezone={user.timezone}
              />
            </section>

            <section className="dossier">
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
            </section>
          </>
        )}
      </div>
    </div>
  );
}
