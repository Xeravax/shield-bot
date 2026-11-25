import { useEffect, useRef, type AnimationEvent, type CSSProperties } from "react";
import type { BootSplashProps } from "./BootSplash";

/** Safety net if boot-seal-out never ends: the reveal takes 1.34s (0.24s reduced). */
const FALLBACK_MS = 1600;
const FALLBACK_REDUCED_MS = 360;

const TITLE = [..."S.H.I.E.L.D."];
const LEGEND = "S.H.I.E.L.D. • SHERIFF’S DEPARTMENT";
const STAR =
  "M0 -3.6L0.81 -1.11H3.42L1.31 0.42L2.12 2.91L0 1.38L-2.12 2.91L-1.31 0.42L-3.42 -1.11H-0.81Z";

/** Full circle round the seal centre (100,100), starting at 12 o'clock. */
function ring(r: number, ccw = false): string {
  const s = ccw ? 0 : 1;
  return `M100 ${100 - r}a${r} ${r} 0 1 ${s} 0 ${2 * r}a${r} ${r} 0 1 ${s} 0 ${-2 * r}`;
}

/** Five stars along the bottom of the legend band (r 75), pointing inward. */
const STARS = [140, 160, 180, 200, 220].map((deg) => {
  const a = (deg * Math.PI) / 180;
  const x = (100 + 75 * Math.sin(a)).toFixed(2);
  const y = (100 - 75 * Math.cos(a)).toFixed(2);
  return `translate(${x} ${y}) rotate(${deg - 180})`;
});

/**
 * Boot gate, "The Seal": gold rings draw round the S.H.I.E.L.D. badge and the
 * badge is struck into place; the seal idles until App says "finishing", then
 * the bezel clicks, light flashes across the badge and the seal lifts toward
 * the camera, dissolving into the bare desk. Timeline: styles.css "Boot splash".
 */
export function SealSplash({ phase, onDone }: BootSplashProps) {
  const doneRef = useRef(false);
  const label = phase === "loading" ? "Opening dossier…" : "Briefing ready";

  useEffect(() => {
    if (phase !== "finishing") {
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fallback = window.setTimeout(
      () => {
        if (!doneRef.current) {
          doneRef.current = true;
          onDone();
        }
      },
      reduced ? FALLBACK_REDUCED_MS : FALLBACK_MS,
    );
    return () => window.clearTimeout(fallback);
  }, [phase, onDone]);

  // animationend bubbles up from every child: only the root's own boot-seal-out counts.
  function handleAnimationEnd(e: AnimationEvent<HTMLDivElement>) {
    if (
      phase !== "finishing" ||
      e.target !== e.currentTarget ||
      e.animationName !== "boot-seal-out" ||
      doneRef.current
    ) {
      return;
    }
    doneRef.current = true;
    onDone();
  }

  return (
    <div
      className={`boot-seal-splash boot-seal-${phase}`}
      role="status"
      aria-live="polite"
      aria-busy={phase === "loading"}
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="boot-seal-seal" aria-hidden="true">
        <div className="boot-seal-lamp" />
        <div className="boot-seal-dial">
          <svg className="boot-seal-dial-face" viewBox="0 0 200 200">
            <circle className="boot-seal-hair" cx="100" cy="100" r="97.5" />
            <path className="boot-seal-tick" d={ring(94)} pathLength={100} />
            <path className="boot-seal-tick boot-seal-tick-major" d={ring(93)} pathLength={100} />
          </svg>
        </div>
        <svg className="boot-seal-rings" viewBox="0 0 200 200">
          <defs>
            <path id="boot-seal-arc" d="M46.97 153.03A75 75 0 1 1 153.03 153.03" />
          </defs>
          <path className="boot-seal-ring" d={ring(87)} pathLength={100} />
          <path className="boot-seal-ring boot-seal-ring-b" d={ring(83.5, true)} pathLength={100} />
          <path className="boot-seal-ring boot-seal-ring-c" d={ring(66.5)} pathLength={100} />
          <text className="boot-seal-legend">
            <textPath href="#boot-seal-arc" startOffset="50%">
              {LEGEND}
            </textPath>
          </text>
          {STARS.map((transform, i) => (
            <g key={transform} transform={transform}>
              <path className="boot-seal-star" d={STAR} style={{ "--i": i } as CSSProperties} />
            </g>
          ))}
        </svg>
        <span className="boot-seal-shock" />
        <div className="boot-seal-medal">
          <img src="/logo.png" alt="" />
          <span className="boot-seal-sheen" />
        </div>
      </div>

      <div className="boot-seal-copy">
        <p className="boot-seal-title" aria-hidden="true">
          {TITLE.map((ch, i) => (
            <span key={i} style={{ "--i": i } as CSSProperties}>
              {ch}
            </span>
          ))}
        </p>
        <p className="boot-seal-status">
          {/* Keyed by phase, so each status is typed out afresh. */}
          <span
            key={phase}
            className="boot-seal-type"
            style={{ "--n": label.length } as CSSProperties}
          >
            <span className="boot-seal-type-text">{label}</span>
            <span className="boot-seal-caret" aria-hidden="true" />
          </span>
        </p>
      </div>
    </div>
  );
}
