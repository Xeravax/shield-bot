import { useEffect, useMemo, useState } from "react";
import {
  adjustAdminHours,
  fetchAdminHours,
  fetchAdminOverview,
  fetchAdminPosters,
  fetchModlogs,
  HANDBOOK_LINKS,
  patchPoster,
  uploadPoster,
  type AdminOverview,
  type ModlogCase,
  type ModlogNote,
  type PosterSlot,
} from "../api";
import { openExternalLink } from "../discord";
import { mockAdminOverview } from "../mockData";
import { ExternalLink } from "./HandbookSection";
import { PreviewNotice } from "./PreviewNotice";

interface Props {
  token: string;
  preview?: boolean;
}

type AdminSection = "pulse" | "lookup" | "cases" | "posters";

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

  const [posters, setPosters] = useState<PosterSlot[]>([]);
  const [postersVersion, setPostersVersion] = useState(0);
  const [postersJsonUrl, setPostersJsonUrl] = useState("");
  const [postersLoading, setPostersLoading] = useState(false);
  const [editSlot, setEditSlot] = useState(0);
  const [editTitle, setEditTitle] = useState("");
  const [editId, setEditId] = useState("");
  const [editGroupId, setEditGroupId] = useState("");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [posterBusy, setPosterBusy] = useState(false);

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

  useEffect(() => {
    if (preview || !token || section !== "posters") {
      return;
    }
    setPostersLoading(true);
    setError(null);
    fetchAdminPosters(token)
      .then((data) => {
        setPosters(data.posters);
        setPostersVersion(data.version);
        setPostersJsonUrl(data.jsonUrl);
        if (data.posters[0]) {
          setEditSlot(data.posters[0].slot);
          setEditTitle(data.posters[0].title);
          setEditId(data.posters[0].id);
          setEditGroupId(data.posters[0].groupId ?? "");
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setPostersLoading(false));
  }, [token, preview, section]);

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

  const selectedPoster = posters.find((p) => p.slot === editSlot) ?? null;

  const sections: Array<{ id: AdminSection; label: string; hint: string }> = [
    { id: "pulse", label: "Server pulse", hint: "Hours & patrols" },
    { id: "lookup", label: "Member lookup", hint: "Hours & mod history" },
    { id: "cases", label: "Recent cases", hint: "Latest moderation" },
    { id: "posters", label: "Posters", hint: "Community Board" },
  ];

  function selectSection(next: AdminSection) {
    if (next === section) {
      return;
    }
    const order = sections.map((s) => s.id);
    setFlipDir(order.indexOf(next) >= order.indexOf(section) ? "fwd" : "back");
    setSection(next);
  }

  function selectPosterSlot(slot: number) {
    setEditSlot(slot);
    const row = posters.find((p) => p.slot === slot);
    if (row) {
      setEditTitle(row.title);
      setEditId(row.id);
      setEditGroupId(row.groupId ?? "");
    }
    setEditFile(null);
  }

  async function reloadPosters() {
    const data = await fetchAdminPosters(token);
    setPosters(data.posters);
    setPostersVersion(data.version);
    setPostersJsonUrl(data.jsonUrl);
  }

  async function submitPosterUpload() {
    if (preview || posterBusy) {
      return;
    }
    if (!editFile) {
      setError("Choose an image file (PNG, JPEG, or WebP).");
      return;
    }
    if (!editTitle.trim()) {
      setError("Title is required.");
      return;
    }
    setPosterBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await uploadPoster(token, editSlot, editFile, {
        title: editTitle.trim(),
        id: editId.trim() || undefined,
        groupId: editGroupId.trim() || undefined,
      });
      await reloadPosters();
      setEditFile(null);
      setMessage(
        `Uploaded slot ${result.poster.slot} (v${result.version}). Image lives on GitHub Pages.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setPosterBusy(false);
    }
  }

  async function savePosterMeta() {
    if (preview || posterBusy) {
      return;
    }
    setPosterBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await patchPoster(token, editSlot, {
        title: editTitle.trim(),
        id: editId.trim() || undefined,
        groupId: editGroupId.trim(),
      });
      await reloadPosters();
      setMessage(
        `Updated slot ${result.poster.slot} metadata (v${result.version}).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setPosterBusy(false);
    }
  }

  async function togglePosterEnabled(slot: number, enabled: boolean) {
    if (preview || posterBusy) {
      return;
    }
    setPosterBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await patchPoster(token, slot, { enabled });
      await reloadPosters();
      setMessage(
        `Slot ${slot} ${result.poster.enabled ? "enabled" : "disabled"} (v${result.version}).`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setPosterBusy(false);
    }
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

        {section === "posters" && (
          <section className="dossier">
            <div className="dossier-head">
              <div>
                <h2>Community Board posters</h2>
                <p>
                  JSON is metadata only (version, slot, enabled, title, groupId).
                  Images overwrite fixed{" "}
                  <code>FRAME_*.jpg</code> on GitHub Pages — the world ignores
                  image URLs in JSON. New slots need a world re-upload.
                </p>
              </div>
            </div>
            {postersLoading ? (
              <p>Loading posters…</p>
            ) : (
              <>
                <p>
                  Version <strong>{postersVersion}</strong>
                  {postersJsonUrl ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => void openExternalLink(postersJsonUrl)}
                      >
                        Open GitHub JSON
                      </button>
                    </>
                  ) : null}
                </p>

                <table className="case-table">
                  <thead>
                    <tr>
                      <th>Slot</th>
                      <th>Preview</th>
                      <th>File</th>
                      <th>Id</th>
                      <th>Title</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {posters.map((p) => (
                      <tr key={p.slot}>
                        <td>{p.slot}</td>
                        <td>
                          <img
                            src={p.imageUrl}
                            alt=""
                            width={48}
                            height={48}
                            style={{
                              objectFit: "cover",
                              borderRadius: 4,
                              background: "#222",
                            }}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.visibility =
                                "hidden";
                            }}
                          />
                        </td>
                        <td>
                          <code>{p.file}</code>
                        </td>
                        <td>
                          <code>{p.id}</code>
                        </td>
                        <td>{p.title}</td>
                        <td>{p.enabled ? "enabled" : "disabled"}</td>
                        <td>
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => selectPosterSlot(p.slot)}
                          >
                            Edit
                          </button>{" "}
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={posterBusy}
                            onClick={() =>
                              void togglePosterEnabled(p.slot, !p.enabled)
                            }
                          >
                            {p.enabled ? "Disable" : "Enable"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <h3 className="pulse-heading">
                  Upload / replace slot {editSlot}
                </h3>
                {selectedPoster && (
                  <p className="event-meta">Current: {selectedPoster.imageUrl}</p>
                )}
                <div className="form-row">
                  <label>
                    Slot
                    <select
                      value={editSlot}
                      onChange={(e) => selectPosterSlot(Number(e.target.value))}
                    >
                      {posters.map((p) => (
                        <option key={p.slot} value={p.slot}>
                          {p.slot}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Title
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Display title"
                    />
                  </label>
                  <label>
                    Id (slug)
                    <input
                      value={editId}
                      onChange={(e) => setEditId(e.target.value)}
                      placeholder="optional"
                    />
                  </label>
                  <label>
                    VRChat group id
                    <input
                      value={editGroupId}
                      onChange={(e) => setEditGroupId(e.target.value)}
                      placeholder="grp_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    />
                  </label>
                </div>
                <div className="form-row">
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={posterBusy}
                    onClick={() => void savePosterMeta()}
                  >
                    Save metadata
                  </button>
                  <label>
                    Image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) =>
                        setEditFile(e.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn"
                    disabled={posterBusy}
                    onClick={() => void submitPosterUpload()}
                  >
                    {posterBusy ? "Working…" : "Upload framed JPEG"}
                  </button>
                </div>
              </>
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
