/**
 * Which intro animation plays while the dashboard loads.
 *
 * Stored per device: the splash plays before the user's profile is fetched,
 * so the choice can't come from the API.
 */
export type BootIntro = "seal" | "card";

export interface BootIntroOption {
  id: BootIntro;
  label: string;
  description: string;
}

export const BOOT_INTROS: readonly BootIntroOption[] = [
  {
    id: "seal",
    label: "The Seal",
    description:
      "Gold rings draw around the S.H.I.E.L.D. badge, then the seal lifts away.",
  },
  {
    id: "card",
    label: "Case card",
    description:
      "A case card is typed up, then stamped “Briefing ready”.",
  },
];

export const DEFAULT_BOOT_INTRO: BootIntro = "seal";

const STORAGE_KEY = "shield-dashboard:boot-intro";

function isBootIntro(value: unknown): value is BootIntro {
  return BOOT_INTROS.some((option) => option.id === value);
}

export function readBootIntro(): BootIntro {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isBootIntro(stored)) {
      return stored;
    }
  } catch {
    // Storage can be blocked inside the Activity iframe; use the default.
  }
  return DEFAULT_BOOT_INTRO;
}

export function saveBootIntro(intro: BootIntro): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, intro);
  } catch {
    // Not persisted: the default plays next time.
  }
}
