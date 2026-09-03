import { useEffect, useMemo, useState } from "react";
import {
  adjustAdminHours,
  fetchAdminHours,
  fetchAdminOverview,
  fetchModlogs,
  HANDBOOK_LINKS,
  type AdminOverview,
  type ModlogCase,
  type ModlogNote,
} from "../api";
import { openExternalLink } from "../discord";
import { mockAdminOverview } from "../mockData";
import { ExternalLink } from "./HandbookSection";
import { PreviewNotice } from "./PreviewNotice";

interface Props {
  token: string;
  preview?: boolean;
}

type AdminSection = "pulse" | "lookup" | "cases";

export function AdminPanel({ token, preview = false }: Props) {
  const [section, setSection] = useState<AdminSection>("pulse");
  const [flipDir, setFlipDir] = useState<"fwd" | "back">("fwd");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(!preview);
  const [targetId, setTargetId] = useState("");
  const [hoursInfo, setHoursInfo] = useState<{
    label: string;
    hours: number;
    allTimeHours: number;
  } | null>(null);
  const [adjustValue, setAdjustValue] = useState("+1h");
  const [cases, setCases] = useState<ModlogCase[]>([]);
  const [notes, setNotes] = useState<ModlogNote[]>([]);
  const [caseType, setCaseType] = useState("ALL");
  const [caseQuery, setCaseQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preview || !token) {
      setOverviewLoading(false);
      return;
    }
    setOverviewLoading(true);
    fetchAdminOverview(token)
      .then(setOverview)
      .catch((e: Error) => setError(e.message))
      .finally(() => setOverviewLoading(false));
  }, [token, preview]);

  async function lookupMember() {
    if (preview) {
      return;
    }
    if (!/^\d{17,20}$/.test(targetId.trim())) {
      setError("Enter a valid Discord user ID.");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const [hours, modlogs] = await Promise.all([
        fetchAdminHours(token, targetId.trim()),
        fetchModlogs(token, targetId.trim()),
      ]);
      setHoursInfo({
        label: hours.label,
        hours: hours.hours,
        allTimeHours: hours.allTimeHours,
      });
      setCases(modlogs.cases);
      setNotes(modlogs.notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    }
  }

  async function adjustHours() {
    if (preview || !targetId.trim()) {
      return;
    }
    const deltaMs = parseAdjustToMs(adjustValue);
    if (deltaMs === null) {
      setError("Invalid adjustment (e.g. +1h, -30m)");
      return;
    }
    setError(null);
    try {
      const result = await adjustAdminHours(token, targetId.trim(), deltaMs);
      setHoursInfo((prev) =>
        prev
          ? {
              ...prev,
              hours: result.hours,
              label: `${result.month}/${result.year}`,
            }
          : null,
      );
      setMessage(`Adjusted patrol time for ${targetId.trim()}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adjust failed");
    }
  }

  const isOverviewPreview = preview || overviewLoading;
  const displayOverview = isOverviewPreview
    ? mockAdminOverview()
    : overview
      ? normalizeOverview(overview)
      : null;

  const caseTypes = useMemo(() => {
    const types = new Set(
      (displayOverview?.recentCases ?? []).map((c) => c.type),
    );
    return ["ALL", ...Array.from(types).sort()];
  }, [displayOverview]);

  const filteredCases = useMemo(() => {
    const rows = displayOverview?.recentCases ?? [];
    const q = caseQuery.trim().toLowerCase();
    return rows.filter((c) => {
      if (caseType !== "ALL" && c.type !== caseType) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        String(c.caseNumber).includes(q) ||
        c.type.toLowerCase().includes(q) ||
        c.targetId.includes(q) ||
        c.moderatorId.includes(q) ||
        (c.reason ?? "").toLowerCase().includes(q)
      );
    });
  }, [displayOverview, caseType, caseQuery]);

  const sections: Array<{ id: AdminSection; label: string; hint: string }> = [
    { id: "pulse", label: "Server pulse", hint: "Hours & patrols" },
    { id: "lookup", label: "Member lookup", hint: "Hours & mod history" },
    { id: "cases", label: "Recent cases", hint: "Latest moderation" },
  ];

  function selectSection(next: AdminSection) {
    if (next === section) {
      return;
    }
    const order = sections.map((s) => s.id);
    setFlipDir(order.indexOf(next) >= order.indexOf(section) ? "fwd" : "back");
    setSection(next);
  }

  return (
    <div className="panel folder-shell">
      <nav className="folder-rail" aria-label="Admin sections">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`folder-rail-tab folder-rail-${s.id}${section === s.id ? " active" : ""}`}
            onClick={() => selectSection(s.id)}
          >
            <span className="folder-rail-label">{s.label}</span>
            <span className="folder-rail-hint">{s.hint}</span>
          </button>
        ))}
      </nav>

      <div key={section} className={`folder-stage flip-${flipDir}`}>
        {section === "pulse" && (
          <section className={`dossier${isOverviewPreview ? " preview" : ""}`}>
            <div className="dossier-head">
              <div>
                <h2>Server pulse</h2>
                <p>Patrol hours, live sessions, and event backlog.</p>
              </div>
            </div>
            {isOverviewPreview && <PreviewNotice />}
            {displayOverview ? (
              <>
                <div className="grid-2">
                  <Stat
                    label={`${displayOverview.monthLabel} hours`}
                    value={`${displayOverview.monthHoursTotal.toFixed(1)}h`}
                  />
                  <Stat
                    label="On patrol now"
                    value={displayOverview.activePatrolSessions}
                  />
                  <Stat
                    label="Pending (week)"
                    value={displayOverview.pendingEventsThisWeek}
                  />
                  <Stat label="Draft events" value={displayOverview.draftEvents} />
                  <Stat label="Open LOAs" value={displayOverview.openLoas} />
                </div>

                <div className="pulse-split">
                  <div>
                    <h3 className="pulse-heading">Hours this month</h3>
                    {displayOverview.hoursMembers.length === 0 ? (
                      <p>No patrol hours recorded this month.</p>
                    ) : (
                      <table className="case-table">
                        <thead>
                          <tr>
                            <th>Member</th>
                            <th>Hours</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayOverview.hoursMembers.map((m) => (
                            <tr key={m.userId}>
                              <td>{m.displayName}</td>
                              <td>{m.hours.toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div>
                    <h3 className="pulse-heading">Currently patrolling</h3>
                    {displayOverview.activePatrols.length === 0 ? (
                      <p>Nobody on a tracked patrol right now.</p>
                    ) : (
                      <ul className="event-list">
                        {displayOverview.activePatrols.map((s) => (
                          <li key={s.userId} className="event-item">
                            <span className="event-accent" />
                            <div>
                              <div className="event-title">{s.displayName}</div>
                              <div className="event-meta">
                                since {new Date(s.startedAt).toLocaleTimeString()}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p>Loading overview…</p>
            )}
            <div style={{ marginTop: "1rem" }}>
              <ExternalLink href={HANDBOOK_LINKS.staffTraining}>
                Staff Training Handbook
              </ExternalLink>
            </div>
          </section>
        )}

        {section === "lookup" && (
          <section className="dossier">
            <div className="dossier-head">
              <div>
                <h2>Member lookup</h2>
                <p>Patrol hours and moderation history by Discord user ID.</p>
              </div>
            </div>
            {preview && (
              <PreviewNotice message="Member lookup unavailable in sample mode." />
            )}
            <div className="lookup-bar">
              <div className="form-row" style={{ flex: 1, margin: 0 }}>
                <label htmlFor="target-id">Discord user ID</label>
                <input
                  id="target-id"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  placeholder="123456789012345678"
                  disabled={preview}
                />
              </div>
              <button
                type="button"
                className="btn"
                disabled={preview}
                onClick={() => void lookupMember()}
              >
                Look up
              </button>
            </div>

            {hoursInfo && (
              <div className="lookup-results">
                <div className="grid-2">
                  <div className="stat">
                    <div className="label">{hoursInfo.label}</div>
                    <div className="value">{hoursInfo.hours.toFixed(1)}h</div>
                  </div>
                  <div className="stat">
                    <div className="label">All-time</div>
                    <div className="value">
                      {hoursInfo.allTimeHours.toFixed(1)}h
                    </div>
                  </div>
                </div>
                <div className="form-row">
                  <label htmlFor="adjust">Adjust (e.g. +1h, -30m)</label>
                  <div className="btn-row">
                    <input
                      id="adjust"
                      value={adjustValue}
                      onChange={(e) => setAdjustValue(e.target.value)}
                      disabled={preview}
                    />
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={preview}
                      onClick={() => void adjustHours()}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            )}

            {cases.length > 0 && (
              <div className="lookup-block">
                <h3>Mod cases</h3>
                <table className="case-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Type</th>
                      <th>Reason</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map((c) => (
                      <tr key={c.id}>
                        <td>{c.caseNumber}</td>
                        <td>{c.type}</td>
                        <td>{c.reason ?? "—"}</td>
                        <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {notes.length > 0 && (
              <div className="lookup-block">
                <h3>Staff notes</h3>
                <ul className="event-list">
                  {notes.map((n) => (
                    <li key={n.id} className="event-item">
                      <span className="event-accent" />
                      <div>
                        <div className="event-meta">
                          {new Date(n.createdAt).toLocaleString()}
                        </div>
                        <div>{n.content}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {section === "cases" && (
          <section className={`dossier${isOverviewPreview ? " preview" : ""}`}>
            <div className="dossier-head">
              <div>
                <h2>Recent cases</h2>
                <p>Latest moderation activity across the guild.</p>
              </div>
            </div>
            {isOverviewPreview && <PreviewNotice />}
            <div className="lookup-bar">
              <div className="form-row" style={{ flex: 1, margin: 0 }}>
                <label htmlFor="case-query">Search</label>
                <input
                  id="case-query"
                  value={caseQuery}
                  onChange={(e) => setCaseQuery(e.target.value)}
                  placeholder="Case #, user ID, reason…"
                />
              </div>
              <div className="form-row" style={{ margin: 0 }}>
                <label htmlFor="case-type">Type</label>
                <select
                  id="case-type"
                  value={caseType}
                  onChange={(e) => setCaseType(e.target.value)}
                >
                  {caseTypes.map((t) => (
                    <option key={t} value={t}>
                      {t === "ALL" ? "All types" : t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {filteredCases.length > 0 ? (
              <table className="case-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Type</th>
                    <th>Target</th>
                    <th>Moderator</th>
                    <th>Reason</th>
                    <th>Log</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCases.map((c) => (
                    <tr key={c.id}>
                      <td>{c.caseNumber}</td>
                      <td>{c.type}</td>
                      <td>
                        <code>{c.targetId}</code>
                      </td>
                      <td>
                        <code>{c.moderatorId}</code>
                      </td>
                      <td>{c.reason ?? "—"}</td>
                      <td>
                        {c.staffLogUrl ? (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => void openExternalLink(c.staffLogUrl!)}
                          >
                            Staff log
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No cases match this filter.</p>
            )}
          </section>
        )}

        {message && <p style={{ color: "var(--ok)" }}>{message}</p>}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
    </div>
  );
}

function normalizeOverview(raw: AdminOverview): AdminOverview {
  const now = new Date();
  const hoursMembers = raw.hoursMembers ?? [];
  const monthHoursTotal =
    typeof raw.monthHoursTotal === "number"
      ? raw.monthHoursTotal
      : hoursMembers.reduce((sum, m) => sum + (m.hours ?? 0), 0);

  return {
    pendingEventsThisWeek: raw.pendingEventsThisWeek ?? 0,
    draftEvents: raw.draftEvents ?? 0,
    openLoas: raw.openLoas ?? 0,
    activePatrolSessions: raw.activePatrolSessions ?? 0,
    monthLabel:
      raw.monthLabel ||
      now.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    monthHoursTotal,
    hoursMembers,
    activePatrols: raw.activePatrols ?? [],
    recentCases: (raw.recentCases ?? []).map((c) => ({
      ...c,
      staffLogUrl: c.staffLogUrl ?? null,
    })),
  };
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function parseAdjustToMs(input: string): number | null {
  const trimmed = input.trim();
  const match = /^([+-]?)(\d+(?:\.\d+)?)(h|m|s)?$/i.exec(trimmed);
  if (!match) {
    return null;
  }
  const sign = match[1] === "-" ? -1 : 1;
  const num = parseFloat(match[2]);
  const unit = (match[3] ?? "h").toLowerCase();
  const multipliers: Record<string, number> = {
    h: 3_600_000,
    m: 60_000,
    s: 1_000,
  };
  return sign * num * (multipliers[unit] ?? 3_600_000);
}
