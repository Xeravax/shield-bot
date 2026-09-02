import { useEffect, useState } from "react";
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
import { mockAdminOverview } from "../mockData";
import { ExternalLink } from "./HandbookSection";
import { PreviewNotice } from "./PreviewNotice";

interface Props {
  token: string;
  preview?: boolean;
}

export function AdminPanel({ token, preview = false }: Props) {
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
  const displayOverview = isOverviewPreview ? mockAdminOverview() : overview;

  return (
    <div className="panel admin-grid">
      <section className={`surface${isOverviewPreview ? " preview" : ""}`}>
        <div className="surface-head">
          <div>
            <h2>Server pulse</h2>
            <p>Live counts across membership, events, and patrols.</p>
          </div>
        </div>
        {isOverviewPreview && <PreviewNotice />}
        {displayOverview ? (
          <div className="grid-2">
            <Stat label="Recruit+" value={displayOverview.recruitPlus} />
            <Stat label="Deputy+" value={displayOverview.deputyPlus} />
            <Stat
              label="Pending (week)"
              value={displayOverview.pendingEventsThisWeek}
            />
            <Stat label="Draft events" value={displayOverview.draftEvents} />
            <Stat label="Open LOAs" value={displayOverview.openLoas} />
            <Stat
              label="Active patrols"
              value={displayOverview.activePatrolSessions}
            />
          </div>
        ) : (
          <p>Loading overview…</p>
        )}
        <div style={{ marginTop: "1rem" }}>
          <ExternalLink href={HANDBOOK_LINKS.staffTraining}>
            Staff Training Handbook
          </ExternalLink>
        </div>
      </section>

      <section className="surface">
        <div className="surface-head">
          <div>
            <h2>Member lookup</h2>
            <p>Hours and moderation history by Discord ID.</p>
          </div>
        </div>
        {preview && (
          <PreviewNotice message="Member lookup unavailable in sample mode." />
        )}
        <div className="form-row">
          <label htmlFor="target-id">Discord user ID</label>
          <input
            id="target-id"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="123456789012345678"
            disabled={preview}
          />
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn secondary"
            disabled={preview}
            onClick={() => void lookupMember()}
          >
            Look up
          </button>
        </div>

        {hoursInfo && (
          <div style={{ marginTop: "1rem" }}>
            <p>
              <strong>{hoursInfo.label}</strong>: {hoursInfo.hours.toFixed(1)}h
              (all-time: {hoursInfo.allTimeHours.toFixed(1)}h)
            </p>
            <div className="form-row">
              <label htmlFor="adjust">Adjust (e.g. +1h, -30m)</label>
              <input
                id="adjust"
                value={adjustValue}
                onChange={(e) => setAdjustValue(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => void adjustHours()}
            >
              Apply adjustment
            </button>
          </div>
        )}

        {cases.length > 0 && (
          <>
            <h3 style={{ marginTop: "1.25rem" }}>Mod cases</h3>
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
          </>
        )}

        {notes.length > 0 && (
          <>
            <h3 style={{ marginTop: "1.25rem" }}>Staff notes</h3>
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
          </>
        )}
      </section>

      {displayOverview && displayOverview.recentCases.length > 0 && (
        <section
          className={`surface${isOverviewPreview ? " preview" : ""}`}
          style={{ gridColumn: "1 / -1" }}
        >
          <div className="surface-head">
            <div>
              <h2>Recent cases</h2>
              <p>Latest moderation activity across the guild.</p>
            </div>
          </div>
          <table className="case-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Type</th>
                <th>Target</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {displayOverview.recentCases.map((c) => (
                <tr key={c.id}>
                  <td>{c.caseNumber}</td>
                  <td>{c.type}</td>
                  <td>{c.targetId}</td>
                  <td>{c.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {message && <p style={{ color: "var(--ok)" }}>{message}</p>}
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
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
