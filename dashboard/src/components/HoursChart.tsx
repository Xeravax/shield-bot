import type { MonthHours } from "../api";

interface Props {
  months: MonthHours[];
}

export function HoursChart({ months }: Props) {
  const width = 640;
  const height = 148;
  const pad = { top: 14, right: 12, bottom: 32, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxHours = Math.max(...months.map((m) => m.hours), 1);
  const niceMax = niceCeil(maxHours);
  const n = Math.max(months.length, 1);

  const points = months.map((m, i) => {
    const x = pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = pad.top + innerH - (m.hours / niceMax) * innerH;
    return { ...m, x, y };
  });

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const area =
    points.length > 0
      ? `${line} L ${points[points.length - 1].x.toFixed(1)} ${(pad.top + innerH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(pad.top + innerH).toFixed(1)} Z`
      : "";

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    value: niceMax * t,
    y: pad.top + innerH - t * innerH,
  }));

  return (
    <div className="hours-chart-wrap">
      <svg
        className="hours-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Monthly patrol hours chart"
      >
        <defs>
          <linearGradient id="hoursArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dfbd6b" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#dfbd6b" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="hoursLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#c9a24e" />
            <stop offset="100%" stopColor="#dfbd6b" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={pad.left}
              x2={pad.left + innerW}
              y1={tick.y}
              y2={tick.y}
              className="chart-grid"
            />
            <text x={pad.left - 10} y={tick.y + 4} className="chart-axis" textAnchor="end">
              {tick.value % 1 === 0 ? tick.value.toFixed(0) : tick.value.toFixed(1)}h
            </text>
          </g>
        ))}

        {area && <path d={area} fill="url(#hoursArea)" />}
        {line && (
          <path
            d={line}
            fill="none"
            stroke="url(#hoursLine)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {points.map((p) => (
          <g key={`${p.year}-${p.month}`} className="chart-point-group">
            <circle
              cx={p.x}
              cy={p.y}
              r={p.isCurrent ? 5 : 3.5}
              className={p.isCurrent ? "chart-point current" : "chart-point"}
            />
            <title>
              {p.label}: {p.hours.toFixed(1)}h
            </title>
            <text
              x={p.x}
              y={height - 14}
              className={`chart-axis${p.isCurrent ? " current" : ""}`}
              textAnchor="middle"
            >
              {p.label.slice(0, 3)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function niceCeil(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const exp = Math.floor(Math.log10(value));
  const f = value / 10 ** exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}
