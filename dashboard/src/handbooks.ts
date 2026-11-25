import { HANDBOOK_LINKS, type DashboardUser } from "./api";

export interface HandbookEntry {
  title: string;
  href: string;
}

export interface HandbookGroup {
  id: "general" | "staff" | "hosting" | "trainer";
  title: string;
  /** Who the group is filed for, shown as a small tag. */
  clearance: string;
  entries: HandbookEntry[];
  /** Shown instead of (or after) entries when something is still locked. */
  lockedNote?: string;
}

const TRAINER_HANDBOOKS: Record<
  DashboardUser["trainerTypes"][number],
  HandbookEntry
> = {
  emt: { title: "EMT Trainer handbook", href: HANDBOOK_LINKS.emtTrainer },
  tru: { title: "TRU Trainer handbook", href: HANDBOOK_LINKS.truTrainer },
  cadet: { title: "Cadet Trainer handbook", href: HANDBOOK_LINKS.cadetTrainer },
};

/** Handbooks every SHIELD member can open (avatar guidelines need Deputy+). */
export function generalHandbooks(user: DashboardUser): HandbookGroup {
  const entries: HandbookEntry[] = [
    { title: "Full SHIELD Handbook", href: HANDBOOK_LINKS.fullHandbook },
    { title: "Phantom Pain List", href: HANDBOOK_LINKS.phantomPain },
  ];
  if (user.deputy) {
    entries.push({
      title: "2026 Avatar Guidelines",
      href: HANDBOOK_LINKS.avatarGuidelines,
    });
  }
  return {
    id: "general",
    title: "General duty",
    clearance: "All members",
    entries,
    lockedNote: user.deputy
      ? undefined
      : "Custom SHIELD avatars may only be used at Deputy+. Representing SHIELD with a personal avatar carries responsibilities.",
  };
}

/** Every handbook group the user's roles unlock, in filing order. */
export function handbookGroups(user: DashboardUser): HandbookGroup[] {
  if (!user.shieldMember) {
    return [];
  }

  const groups: HandbookGroup[] = [generalHandbooks(user)];

  if (user.staff) {
    groups.push({
      id: "staff",
      title: "Staff",
      clearance: "Staff",
      entries: [
        { title: "Staff training handbook", href: HANDBOOK_LINKS.staffTraining },
      ],
    });
  }

  if (user.host) {
    groups.push({
      id: "hosting",
      title: "Event hosting",
      clearance: "Hosts",
      entries: [
        { title: "Event Hosting 101", href: HANDBOOK_LINKS.hosting101 },
        { title: "Attendance system", href: HANDBOOK_LINKS.attendance },
        { title: "Event scheduling system", href: HANDBOOK_LINKS.scheduling },
      ],
    });
  }

  const trainerEntries = user.trainerTypes.map((t) => TRAINER_HANDBOOKS[t]);
  if (trainerEntries.length > 0) {
    groups.push({
      id: "trainer",
      title: "Trainer desks",
      clearance: "Trainers",
      entries: trainerEntries,
    });
  }

  return groups;
}

/** "books/<slug>/…" → "<slug>", used as a typed file reference next to a link. */
export function handbookRef(href: string): string {
  const match = /\/books\/([^/?#]+)/.exec(href);
  return match ? match[1] : new URL(href).hostname;
}
