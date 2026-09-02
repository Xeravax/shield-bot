import { useEffect, useRef, type TransitionEvent } from "react";

export type BootSplashPhase = "loading" | "finishing";

interface Props {
  phase: BootSplashPhase;
  onDone: () => void;
}

const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;

export function BootSplash({ phase, onDone }: Props) {
  const doneRef = useRef(false);

  useEffect(() => {
    if (phase !== "finishing") {
      return;
    }
    const fallback = window.setTimeout(() => {
      if (!doneRef.current) {
        doneRef.current = true;
        onDone();
      }
    }, 750);
    return () => window.clearTimeout(fallback);
  }, [phase, onDone]);

  function handleTransitionEnd(e: TransitionEvent<SVGCircleElement>) {
    if (e.propertyName !== "stroke-dashoffset") {
      return;
    }
    if (doneRef.current) {
      return;
    }
    doneRef.current = true;
    onDone();
  }

  return (
    <div
      className="boot-splash"
      role="status"
      aria-live="polite"
      aria-busy={phase === "loading"}
    >
      <div className={`boot-mark ${phase}`}>
        <svg className="boot-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle className="boot-ring-track" cx="60" cy="60" r={RING_R} />
          <circle
            className="boot-ring-arc"
            cx="60"
            cy="60"
            r={RING_R}
            style={{
              strokeDasharray: RING_C,
              strokeDashoffset: phase === "finishing" ? 0 : RING_C * 0.72,
            }}
            onTransitionEnd={handleTransitionEnd}
          />
        </svg>
        <img className="boot-logo" src="/logo.png" alt="S.H.I.E.L.D." />
      </div>
      <p className="boot-kicker">S.H.I.E.L.D.</p>
      <p className="boot-caption">
        {phase === "loading" ? "Connecting…" : "Ready"}
      </p>
    </div>
  );
}
