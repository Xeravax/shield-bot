import { useEffect, useMemo, useState } from "react";
import {
  approveHostEvent,
  createHostEvent,
  deleteHostEvent,
  denyHostEvent,
  fetchEvents,
  fetchHostEvents,
  HANDBOOK_LINKS,
  setTimezone,
  submitHostEvent,
  updateHostEvent,
  validateHostEvent,
  type CalendarEvent,
  type DashboardUser,
  type EventRuleResult,
} from "../api";
import {
  formatClock,
  formatNaturalDayTime,
  rangesOverlap,
  startOfMonth,
  startOfWeek,
  zonedDate,
} from "../calendarUtils";
import { mockCalendarEvents } from "../mockData";
import { Dialog } from "./Dialog";
import { ExternalLink } from "./HandbookSection";
import { MonthCalendar } from "./MonthCalendar";
import { PreviewNotice } from "./PreviewNotice";
import { WeekCalendar } from "./WeekCalendar";

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
  const [boardDay, setBoardDay] = useState<Date>(() => new Date());
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [duty, setDuty] = useState<"ON_DUTY" | "OFF_DUTY">("ON_DUTY");
  const [duration, setDuration] = useState(120);
  const [eventType, setEventType] = useState("");
  const [force, setForce] = useState(false);
  const [rules, setRules] = useState<EventRuleResult[]>([]);
  const [blocking, setBlocking] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [validationOpen, setValidationOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CalendarEvent | null>(null);
  const [pendingDeny, setPendingDeny] = useState<CalendarEvent | null>(null);
  const [denyReason, setDenyReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<CalendarEvent[]>([]);
  const [managed, setManaged] = useState<CalendarEvent[]>([]);
  const [hostSection, setHostSection] = useState<
    "schedule" | "queue" | "board"
  >("schedule");
  const [flipDir, setFlipDir] = useState<"fwd" | "back">("fwd");

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
    fetchEvents(token, range.from, range.to, { planning: true })
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

  const proposed = useMemo(() => {
    const [datePart, timePart] = startsAt.split("T");
    if (!datePart) {
      return null;
    }
    const [y, m, d] = datePart.split("-").map(Number);
    const [hh, mm] = (timePart ?? "20:00").split(":").map(Number);
    const start = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
    const end = new Date(start.getTime() + duration * 60_000);
    return { start, end, title: title.trim() || "New event" };
  }, [startsAt, duration, title]);

  const collidingIds = useMemo(() => {
    if (!proposed) {
      return new Set<number>();
    }
    const ids = new Set<number>();
    for (const event of displayPublished) {
      if (editingId != null && event.id === editingId) {
        continue;
      }
      if (
        rangesOverlap(
          proposed.start.getTime(),
          proposed.end.getTime(),
          new Date(event.startTime).getTime(),
          new Date(event.endTime).getTime(),
        )
      ) {
        ids.add(event.id);
      }
    }
    return ids;
  }, [displayPublished, proposed, editingId]);

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
    setFieldErrors({});
    setValidationOpen(false);
  }

  function loadEventIntoForm(event: CalendarEvent) {
    const local = zonedDate(event.startTime, user.timezone);
    setEditingId(event.id);
    setTitle(event.title);
    setStartsAt(toDatetimeLocal(local));
    setDuty(event.duty === "OFF_DUTY" ? "OFF_DUTY" : "ON_DUTY");
    setDuration(event.durationMinutes);
    setEventType(event.eventType ?? "");
    setWeekStart(startOfWeek(local));
    setMessage(null);
    setError(null);
    setRules([]);
    setFieldErrors({});
    setFlipDir("back");
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
      applyValidation(result.results, result.blocking);
      if (!result.blocking && !result.results.some((r) => r.severity === "fail")) {
        setMessage("No blocking issues for this slot.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setBusy(false);
    }
  }

  async function refreshLists() {
    await refreshManaged();
    if (preview || !token) {
      return;
    }
    try {
      const data = await fetchEvents(token, range.from, range.to, {
        planning: true,
      });
      setPublished(data.events);
    } catch {
      // Keep existing calendar data on refresh failure.
    }
  }

  async function saveDraft() {
    if (preview) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const validation = await validateHostEvent(token, eventBody());
      if (validation.blocking) {
        applyValidation(validation.results, true);
        return;
      }
      applyValidation(validation.results, false);
      if (editingId != null) {
        const result = await updateHostEvent(token, editingId, eventBody());
        setRules(result.validation.results);
        setMessage(`Updated draft #${result.eventId}.`);
      } else {
        const result = await createHostEvent(token, eventBody());
        setRules(result.validation.results);
        setMessage(
          `Draft event #${result.eventId} saved. Use Submit for review to post it.`,
        );
      }
      resetForm();
      await refreshLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save event");
    } finally {
      setBusy(false);
    }
  }

  async function submitForReview(eventId?: number) {
    if (preview) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      let id = eventId ?? editingId;
      if (id == null) {
        const validation = await validateHostEvent(token, eventBody());
        if (validation.blocking) {
          applyValidation(validation.results, true);
          return;
        }
        const created = await createHostEvent(token, eventBody());
        id = created.eventId;
      } else if (eventId == null) {
        const validation = await validateHostEvent(token, eventBody());
        if (validation.blocking) {
          applyValidation(validation.results, true);
          return;
        }
        await updateHostEvent(token, id, eventBody());
      }

      const result = await submitHostEvent(token, id);
      setMessage(result.message);
      resetForm();
      await refreshLists();
      setFlipDir("fwd");
      setHostSection("queue");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit event");
    } finally {
      setBusy(false);
    }
  }

  async function approveEvent(event: CalendarEvent) {
    if (preview || !user.hostLead) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await approveHostEvent(token, event.id);
      setMessage(result.message);
      await refreshLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve event");
    } finally {
      setBusy(false);
    }
  }

  function openDeny(event: CalendarEvent) {
    if (preview || !user.hostLead) {
      return;
    }
    setDenyReason("");
    setPendingDeny(event);
  }

  async function confirmDeny() {
    const event = pendingDeny;
    const reason = denyReason.trim();
    if (!event) {
      return;
    }
    if (!reason) {
      setError("A denial reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await denyHostEvent(token, event.id, reason);
      setMessage(result.message);
      setPendingDeny(null);
      setDenyReason("");
      await refreshLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to deny event");
    } finally {
      setBusy(false);
    }
  }

  async function removeEvent(event: CalendarEvent) {
    if (preview || event.canDelete === false) {
      return;
    }
    setPendingDelete(event);
  }

  async function confirmDelete() {
    const event = pendingDelete;
    if (!event) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await deleteHostEvent(token, event.id);
      setMessage(result.message);
      setPendingDelete(null);
      if (editingId === event.id) {
        resetForm();
      }
      await refreshLists();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete event");
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  }

  function applyValidation(nextRules: EventRuleResult[], isBlocking: boolean) {
    setRules(nextRules);
    setBlocking(isBlocking);
    const nextFields = fieldErrorsFromRules(nextRules);
    setFieldErrors(nextFields);
    if (isBlocking || nextRules.some((r) => r.severity === "fail")) {
      setValidationOpen(true);
      setError("Fix the highlighted fields before submitting.");
    } else {
      setValidationOpen(false);
      setError(null);
    }
  }

  function eventActions(event: CalendarEvent) {
    const status = event.status.toUpperCase();
    const canSubmit =
      event.canEdit !== false && (status === "DRAFT" || status === "DENIED");
    const canReview = user.hostLead && status === "PENDING";

    return (
      <div className="btn-row">
        {canSubmit && (
          <button
            type="button"
            className="btn"
            disabled={preview || busy}
            onClick={() => void submitForReview(event.id)}
          >
            Submit
          </button>
        )}
        {canReview && (
          <>
            <button
              type="button"
              className="btn"
              disabled={preview || busy}
              onClick={() => void approveEvent(event)}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn secondary danger"
              disabled={preview || busy}
              onClick={() => openDeny(event)}
            >
              Deny
            </button>
          </>
        )}
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
        {event.canDelete !== false && (
          <button
            type="button"
            className="btn secondary danger"
            disabled={preview || busy}
            onClick={() => void removeEvent(event)}
          >
            Delete
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="panel folder-shell">
      <nav className="folder-rail" aria-label="Host sections">
        {(
          [
            {
              id: "schedule" as const,
              label: "Schedule",
              hint: "Submit for roster",
            },
            { id: "queue" as const, label: "Queue", hint: "Review & drafts" },
            {
              id: "board" as const,
              label: "Board",
              hint: "Roster + pending",
            },
          ] as const
        ).map((s) => (
          <button
            key={s.id}
            type="button"
            className={`folder-rail-tab folder-rail-${s.id}${hostSection === s.id ? " active" : ""}`}
            onClick={() => {
              if (s.id === hostSection) {
                return;
              }
              const order = ["schedule", "queue", "board"] as const;
              setFlipDir(
                order.indexOf(s.id) >= order.indexOf(hostSection)
                  ? "fwd"
                  : "back",
              );
              setHostSection(s.id);
            }}
          >
            <span className="folder-rail-label">{s.label}</span>
            <span className="folder-rail-hint">{s.hint}</span>
          </button>
        ))}
      </nav>

      <div key={hostSection} className={`folder-stage flip-${flipDir}`}>
        {hostSection === "schedule" && (
          <section className={`dossier${preview ? " preview" : ""}`}>
            <div className="dossier-head">
              <div>
                <h2>
                  {editingId != null ? "Edit roster entry" : "Submit for roster"}
                </h2>
                <p>
                  Pick a start date &amp; time in{" "}
                  <strong>{user.timezone}</strong>. Save a draft, or submit for
                  review to post it in the planning channel
                  {user.hostLead
                    ? ". As a team lead you can also approve or deny from Queue."
                    : "."}
                </p>
              </div>
            </div>
            {preview && (
              <PreviewNotice message="Event scheduling unavailable in sample mode." />
            )}

            <div className="schedule-split">
              <div className="schedule-form">
            <div className={`form-row${fieldErrors.title ? " has-error" : ""}`}>
              <label htmlFor="title">Title</label>
              <input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Patrol Event"
                disabled={preview}
              />
              <FieldHint message={fieldErrors.title} />
            </div>

            <div className={`form-row${fieldErrors.startsAt ? " has-error" : ""}`}>
              <label htmlFor="starts">Starts at (local)</label>
              <input
                id="starts"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => {
                  setStartsAt(e.target.value);
                  const [datePart] = e.target.value.split("T");
                  const [y, m, d] = datePart.split("-").map(Number);
                  if (y && m && d) {
                    setWeekStart(startOfWeek(new Date(y, m - 1, d)));
                  }
                }}
                disabled={preview}
              />
              <FieldHint message={fieldErrors.startsAt} />
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

            <div className={`form-row${fieldErrors.duty ? " has-error" : ""}`}>
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
              <FieldHint message={fieldErrors.duty} />
            </div>
            <div className={`form-row${fieldErrors.duration ? " has-error" : ""}`}>
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
              <FieldHint message={fieldErrors.duration} />
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
              <div className={`force-switch-row${fieldErrors.force ? " has-error" : ""}`}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={force}
                  className={`force-switch${force ? " on" : ""}`}
                  disabled={preview}
                  onClick={() => setForce((v) => !v)}
                >
                  <span className="force-switch-knob" />
                </button>
                <div>
                  <strong>Force</strong>
                  <p>Bypass week and collision rules (team lead).</p>
                  <FieldHint message={fieldErrors.force} />
                </div>
              </div>
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
                className="btn secondary"
                disabled={preview || busy || !title.trim()}
                onClick={() => void saveDraft()}
              >
                {editingId != null ? "Save draft" : "Create draft"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={preview || busy || !title.trim()}
                onClick={() => void submitForReview()}
              >
                Submit for review
              </button>
              {editingId != null && (
                <>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy}
                    onClick={resetForm}
                  >
                    Cancel edit
                  </button>
                  <button
                    type="button"
                    className="btn secondary danger"
                    disabled={preview || busy}
                    onClick={() => {
                      const current =
                        displayPublished.find((e) => e.id === editingId) ??
                        managed.find((e) => e.id === editingId);
                      if (current) {
                        void removeEvent(current);
                      }
                    }}
                  >
                    Delete
                  </button>
                </>
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
              </div>

              <div className="schedule-week">
                {collidingIds.size > 0 && (
                  <p className="collision-banner">
                    Collision with {collidingIds.size} existing event
                    {collidingIds.size === 1 ? "" : "s"} — red overlay on the
                    week board.
                  </p>
                )}
                <WeekCalendar
                  weekStart={weekStart}
                  onWeekChange={setWeekStart}
                  events={displayPublished.filter((e) => e.id !== editingId)}
                  timezone={user.timezone}
                  proposed={proposed}
                  collidingIds={collidingIds}
                  onSelectSlot={(local) => {
                    setStartsAt(toDatetimeLocal(local));
                    setWeekStart(startOfWeek(local));
                  }}
                  onSelectEvent={(event) => {
                    if (event.canEdit !== false) {
                      loadEventIntoForm(event);
                    }
                  }}
                />
              </div>
            </div>
          </section>
        )}

        {hostSection === "queue" && (
          <section className={`dossier${preview ? " preview" : ""}`}>
            <div className="dossier-head">
              <div>
                <h2>Your queue</h2>
                <p>
                  {user.hostLead
                    ? "Drafts, pending review, and denied events — approve or deny pending ones here."
                    : "Your drafts, pending submissions, and denied events."}
                </p>
              </div>
            </div>
            {message && <p style={{ color: "var(--ok)" }}>{message}</p>}
            {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
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
                    {eventActions(event)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {hostSection === "board" && (
          <>
            <section className={`dossier board-panel${preview ? " preview" : ""}`}>
              <div className="dossier-head">
                <div>
                  <h2>Event board</h2>
                  <p>
                    Published roster plus drafts and pending review. Submit,
                    approve, or deny without leaving the dashboard.
                  </p>
                </div>
              </div>
              {message && <p style={{ color: "var(--ok)" }}>{message}</p>}
              {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
              <MonthCalendar
                viewMonth={viewMonth}
                onViewMonthChange={(month) => {
                  setViewMonth(month);
                  setBoardDay(new Date(month));
                }}
                events={displayPublished}
                timezone={user.timezone}
                selectedDay={boardDay}
                onSelectDay={setBoardDay}
                selectable
              />
              <div className="day-detail">
                <h3>
                  {boardDay.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </h3>
                {displayPublished.filter((event) => {
                  const local = zonedDate(event.startTime, user.timezone);
                  return (
                    local.getFullYear() === boardDay.getFullYear() &&
                    local.getMonth() === boardDay.getMonth() &&
                    local.getDate() === boardDay.getDate()
                  );
                }).length === 0 ? (
                  <p>No events this day. Click a slot on Schedule to create one.</p>
                ) : (
                  <ul className="event-list">
                    {displayPublished
                      .filter((event) => {
                        const local = zonedDate(event.startTime, user.timezone);
                        return (
                          local.getFullYear() === boardDay.getFullYear() &&
                          local.getMonth() === boardDay.getMonth() &&
                          local.getDate() === boardDay.getDate()
                        );
                      })
                      .map((event) => (
                        <li
                          key={event.id}
                          className={`event-item ${event.duty === "OFF_DUTY" ? "offduty" : ""} ${event.status === "PENDING" || event.status === "DRAFT" ? "pending" : ""}`}
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
                          <div>{eventActions(event)}</div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
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
      {validationOpen && (
        <Dialog
          title={blocking ? "Cannot submit yet" : "Validation"}
          tone={blocking ? "danger" : "default"}
          onClose={() => setValidationOpen(false)}
        >
          <ul className="rule-list">
            {rules
              .filter((r) => r.severity !== "pass")
              .map((r) => (
                <li key={r.id} className={`rule-item ${r.severity}`}>
                  <strong>{r.label}:</strong> {r.message}
                </li>
              ))}
          </ul>
        </Dialog>
      )}
      {pendingDelete && (
        <Dialog
          title="Delete event"
          tone="danger"
          onClose={() => setPendingDelete(null)}
          actions={
            <>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setPendingDelete(null)}
              >
                Keep it
              </button>
              <button
                type="button"
                className="btn danger-solid"
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                Delete
              </button>
            </>
          }
        >
          <p>
            Delete <strong>{pendingDelete.title}</strong>? This removes the
            draft or cancels it on the roster. It cannot be undone.
          </p>
        </Dialog>
      )}
      {pendingDeny && (
        <Dialog
          title="Deny event"
          tone="danger"
          onClose={() => {
            setPendingDeny(null);
            setDenyReason("");
          }}
          actions={
            <>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setPendingDeny(null);
                  setDenyReason("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn danger-solid"
                disabled={busy || !denyReason.trim()}
                onClick={() => void confirmDeny()}
              >
                Deny
              </button>
            </>
          }
        >
          <p>
            Deny <strong>{pendingDeny.title}</strong> and notify the host.
          </p>
          <div className={`form-row${!denyReason.trim() ? " has-error" : ""}`}>
            <label htmlFor="deny-reason">Reason</label>
            <textarea
              id="deny-reason"
              rows={3}
              value={denyReason}
              onChange={(e) => setDenyReason(e.target.value)}
              placeholder="Why this event is being denied"
              disabled={busy}
            />
            {!denyReason.trim() && (
              <p className="field-error">A denial reason is required.</p>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function FieldHint({ message }: { message?: string }) {
  if (!message) {
    return null;
  }
  return <p className="field-error">{message}</p>;
}

const RULE_FIELD: Record<string, string> = {
  title: "title",
  time: "startsAt",
  "monday-ban": "startsAt",
  "scheduling-window": "startsAt",
  overlap: "startsAt",
  "offduty-collision": "startsAt",
  duration: "duration",
  "duration-3h": "duration",
  "duration-invalid": "duration",
  "host-weekly-limit": "force",
  "host-role": "force",
};

function fieldErrorsFromRules(rules: EventRuleResult[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const rule of rules) {
    if (rule.severity !== "fail") {
      continue;
    }
    const field = RULE_FIELD[rule.id] ?? "startsAt";
    if (!next[field]) {
      next[field] = rule.message;
    }
  }
  return next;
}
