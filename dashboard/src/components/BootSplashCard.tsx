import { useCallback, useEffect, useRef } from "react";
import type { AnimationEvent, CSSProperties } from "react";
import type { BootSplashProps } from "./BootSplash";

interface Field {
  label: string;
  value: string;
  /** ms after mount when the typewriter starts this value. */
  at: number;
  redact?: boolean;
}

// Intro (ms after mount): card lands 0-680, seal 260-820, values typed 660-1940
// at 24 ms per character (--boot-card-cps), source redacted 1660-1920. Then idle.
const FIELDS: Field[] = [
  { label: "To", value: "DUTY OFFICER", at: 660 },
  { label: "Re", value: "DAILY BRIEFING", at: 1000 },
  { label: "Source", value: "CLASSIFIED", at: 1380, redact: true },
];
const VERIFY_AT = 1720;

// Finishing (ms after the switch): GRANTED typed from 150, stamp slams ~545,
// lift-off (boot-card-exit) ends at 1360 -> onDone. The timer only backs that up.
const GRANT_AT = 150;
const FALLBACK_MS = 1560;
const REDUCED_FALLBACK_MS = 390;

/** CSS typewriter inputs: character count and start delay. */
function typed(text: string, at: number): CSSProperties {
  return { "--n": text.length, "--d": `${at}ms` } as CSSProperties;
}

/** Teletype intake: a case card is typed up while loading, then cleared,
 *  stamped and lifted off the desk to reveal the dashboard. */
export function CardSplash({ phase, onDone }: BootSplashProps) {
  const finishing = phase === "finishing";
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const finish = useCallback(() => {
    if (doneRef.current) {
      return;
    }
    doneRef.current = true;
    onDoneRef.current();
  }, []);

  // Fallback for reduced motion, throttled background tabs, disabled animations.
  useEffect(() => {
    if (!finishing) {
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(finish, reduced ? REDUCED_FALLBACK_MS : FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [finishing, finish]);

  function handleAnimationEnd(e: AnimationEvent<HTMLDivElement>) {
    // animationend bubbles up from every value, caret and the stamp:
    // only the stage's own exit counts.
    if (e.target === e.currentTarget && e.animationName === "boot-card-exit") {
      finish();
    }
  }

  return (
    <div
      className="boot-card-splash"
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-busy={phase === "loading"}
    >
      <div className="boot-card-stage" onAnimationEnd={handleAnimationEnd}>
        <div className="boot-card-glow" aria-hidden="true" />

        <div className="boot-card-card" aria-hidden="true">
          <div className="boot-card-sheet">
            <span className="boot-card-form">FORM S-7</span>
            <div className="boot-card-head">
              <img className="boot-card-seal" src="/logo.png" alt="" />
              <div>
                <p className="boot-card-title">S.H.I.E.L.D.</p>
                <p className="boot-card-kicker">Sheriff&rsquo;s Department · Case File</p>
              </div>
            </div>
            <div className="boot-card-rule" />

            {FIELDS.map((f) => (
              <div className="boot-card-row" key={f.label}>
                <span className="boot-card-label">{f.label}</span>
                <span className="boot-card-val boot-card-typed" style={typed(f.value, f.at)}>
                  <span className="boot-card-ink">{f.value}</span>
                  {f.redact && <span className="boot-card-redact" />}
                </span>
              </div>
            ))}

            <div className="boot-card-row">
              <span className="boot-card-label">Clearance</span>
              <span className="boot-card-val boot-card-swap">
                <span className="boot-card-typed boot-card-verify" style={typed("VERIFYING", VERIFY_AT)}>
                  <span className="boot-card-ink">VERIFYING</span>
                </span>
                {finishing && (
                  <span className="boot-card-typed boot-card-grant" style={typed("GRANTED", GRANT_AT)}>
                    <span className="boot-card-ink">GRANTED</span>
                  </span>
                )}
              </span>
            </div>

            {finishing && (
              <span className="boot-card-stamp">
                <small>Briefing</small>
                <b>Ready</b>
              </span>
            )}
          </div>
        </div>

        <p className="boot-card-status">
          <span key={phase} className="boot-card-status-text">
            {finishing ? "Briefing ready" : "Opening dossier"}
          </span>
          {!finishing && (
            <span className="boot-card-dots" aria-hidden="true">
              <i>.</i>
              <i>.</i>
              <i>.</i>
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
