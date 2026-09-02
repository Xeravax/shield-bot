import { HANDBOOK_LINKS, type DashboardUser } from "../api";
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
  const sections = TRAINER_SECTIONS.filter((s) =>
    user.trainerTypes.includes(s.type),
  );

  if (sections.length === 0) {
    return (
      <div className="panel">
        <section className="surface">
          <p>No trainer roles assigned.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="panel trainer-grid">
      {sections.map((s) => (
        <section key={s.type} className="surface">
          <div className="surface-head">
            <div>
              <h2>{s.title}</h2>
              <p>{s.blurb}</p>
            </div>
          </div>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
            More trainer tools will be added here later.
          </p>
          <ExternalLink href={s.href}>Open trainer handbook</ExternalLink>
        </section>
      ))}
    </div>
  );
}
