import { useEffect, useRef } from "react";

export type BootSplashPhase = "loading" | "finishing";

interface Props {
  phase: BootSplashPhase;
  onDone: () => void;
}

/** Briefing-folder boot gate: idle closed while loading, then opens to reveal. */
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
    }, 1400);
    return () => window.clearTimeout(fallback);
  }, [phase, onDone]);

  function handleOpenEnd() {
    if (phase !== "finishing" || doneRef.current) {
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
      <div className={`boot-folder ${phase}`}>
        <div className="folder-shadow" aria-hidden="true" />

        <div
          className="folder-stage"
          onAnimationEnd={(e) => {
            if (
              phase === "finishing" &&
              e.animationName === "folder-reveal-done"
            ) {
              handleOpenEnd();
            }
          }}
        >
          <div className="folder-back" aria-hidden="true" />

          <div className="folder-paper">
            <img src="/logo.png" alt="" />
            <p className="boot-kicker">S.H.I.E.L.D.</p>
            <p className="boot-caption">
              {phase === "loading" ? "Opening dossier…" : "Briefing ready"}
            </p>
          </div>

          <div className="folder-body" aria-hidden="true">
            <span className="folder-tab">BRIEFING</span>
            <span className="folder-label">DUTY FILE</span>
          </div>

          <div className="folder-flap" aria-hidden="true">
            <span className="folder-flap-edge" />
          </div>
        </div>
      </div>
    </div>
  );
}
