import { HANDBOOK_LINKS, type DashboardUser } from "../api";
import { useMemo, useState } from "react";
import { ExternalLink } from "./HandbookSection";

interface Props {
  user: DashboardUser;
}

const TRAINER_SECTIONS: Array<{
  type: "emt" | "tru" | "cadet";
  title: string;
  href: string;
  blurb: string;
}> = [
  {
    type: "emt",
    title: "EMT Trainer",
    href: HANDBOOK_LINKS.emtTrainer,
    blurb: "Emergency Medical Technician training resources and shelf books.",
  },
  {
    type: "tru",
    title: "TRU Trainer",
    href: HANDBOOK_LINKS.truTrainer,
    blurb: "Tactical Response Unit training resources and shelf books.",
  },
  {
    type: "cadet",
    title: "Cadet Trainer",
    href: HANDBOOK_LINKS.cadetTrainer,
    blurb: "Cadet training handbook and trainer procedures.",
  },
];

export function TrainerPanel({ user }: Props) {
  const sections = useMemo(
    () =>
      TRAINER_SECTIONS.filter((s) => user.trainerTypes.includes(s.type)),
    [user.trainerTypes],
  );
  const [active, setActive] = useState(sections[0]?.type ?? "emt");
  const [flipDir, setFlipDir] = useState<"fwd" | "back">("fwd");
  const current =
    sections.find((s) => s.type === active) ?? sections[0] ?? null;

  if (sections.length === 0 || !current) {
    return (
      <div className="panel">
        <section className="dossier">
          <p>No trainer roles assigned.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="panel folder-shell">
      <nav className="folder-rail" aria-label="Trainer assignments">
        {sections.map((s) => (
          <button
            key={s.type}
            type="button"
            className={`folder-rail-tab folder-rail-${s.type}${current.type === s.type ? " active" : ""}`}
            onClick={() => {
              if (s.type === active) {
                return;
              }
              const order = sections.map((x) => x.type);
              setFlipDir(
                order.indexOf(s.type) >= order.indexOf(active) ? "fwd" : "back",
              );
              setActive(s.type);
            }}
          >
            <span className="folder-rail-label">{s.title}</span>
            <span className="folder-rail-hint">{s.type.toUpperCase()}</span>
          </button>
        ))}
      </nav>

      <div key={current.type} className={`folder-stage flip-${flipDir}`}>
        <section className="dossier trainer-dossier">
          <div className="dossier-head">
            <div>
              <h2>{current.title}</h2>
              <p>{current.blurb}</p>
            </div>
          </div>
          <p className="trainer-note">
            Assignment desk — handbook for this role. More tools will land here
            later.
          </p>
          <ExternalLink href={current.href}>Open trainer handbook</ExternalLink>
        </section>
      </div>
    </div>
  );
}
