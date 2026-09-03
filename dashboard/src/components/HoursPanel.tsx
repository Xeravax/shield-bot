import { useEffect, useState } from "react";
import { fetchHours, type DashboardUser, type MonthHours } from "../api";
import { mockMonthHours } from "../mockData";
import { HoursChart } from "./HoursChart";
import { PreviewNotice } from "./PreviewNotice";

interface Props {
  token: string;
  user: DashboardUser;
  preview?: boolean;
}

export function HoursPanel({ token, user, preview = false }: Props) {
  const [months, setMonths] = useState<MonthHours[]>([]);
  const [range, setRange] = useState(6);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user.shieldMember || preview || !token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchHours(token, range)
      .then((data) => setMonths(data.months))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, range, user.shieldMember, preview]);

  if (!user.shieldMember) {
    return null;
  }

  const isPreview = preview || loading;
  const displayMonths = isPreview ? mockMonthHours(range) : months;
  const current = displayMonths.find((m) => m.isCurrent) ?? displayMonths.at(-1);
  const total = displayMonths.reduce((sum, m) => sum + m.hours, 0);

  return (
    <section className={`dossier hours-panel${isPreview ? " preview" : ""}`}>
      <div className="dossier-head">
        <div>
          <h2>Patrol hours</h2>
          <p>Current month spotlight — UTC months.</p>
        </div>
        <div className="chip-row" role="group" aria-label="Month range">
          {[3, 6, 12].map((n) => (
            <button
              key={n}
              type="button"
              className={`chip ${range === n ? "active" : ""}`}
              onClick={() => setRange(n)}
              disabled={preview && !token}
            >
              {n} mo
            </button>
          ))}
        </div>
      </div>

      {isPreview && <PreviewNotice />}
      {error && !isPreview && (
        <p style={{ color: "var(--danger)" }}>{error}</p>
      )}

      <div className="hours-hero">
        <div className="hours-hero-value">
          {(current?.hours ?? 0).toFixed(1)}
          <span>{current?.label ?? "This month"} · hours</span>
        </div>
        <div className="hours-hero-side">
          <div className="stat">
            <div className="label">Window total</div>
            <div className="value">{total.toFixed(1)}h</div>
          </div>
          <div className="stat">
            <div className="label">Months</div>
            <div className="value">{displayMonths.length}</div>
          </div>
        </div>
      </div>

      <HoursChart months={displayMonths} />
    </section>
  );
}
