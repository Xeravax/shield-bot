export const POSTERS_MAX_SLOTS = 8;
export const POSTERS_STATION_PREFIX = "station";
export const POSTERS_JSON_PATH = `${POSTERS_STATION_PREFIX}/poster.json`;
export const POSTERS_IMAGE_DIR = `${POSTERS_STATION_PREFIX}/posters`;

/**
 * Existing framed JPEGs already in Station_Whitelists under station/posters/.
 * Use these official filenames as baked VRCUrls — do not rename or re-upload.
 */
export const DEFAULT_STATION_FRAME_POSTERS = [
  {
    slot: 0,
    slug: "cobalt",
    title: "Cobalt Conclave",
    imageFile: "FRAME_COBALT.jpg",
  },
  {
    slot: 1,
    slug: "hoppu",
    title: "Hoppu",
    imageFile: "FRAME_HOPPU.jpg",
  },
  {
    slot: 2,
    slug: "kus",
    title: "KUS",
    imageFile: "FRAME_KUS.jpg",
  },
  {
    slot: 3,
    slug: "lab",
    title: "LAB",
    imageFile: "FRAME_LAB.jpg",
  },
  {
    slot: 4,
    slug: "mps",
    title: "MPS",
    imageFile: "FRAME_MPS.jpg",
  },
  {
    slot: 5,
    slug: "pridevr",
    title: "PrideVR",
    imageFile: "FRAME_PRIDEVR.jpg",
  },
  {
    slot: 6,
    slug: "psi",
    title: "PSI",
    imageFile: "FRAME_PSI.jpg",
  },
] as const;

export interface PosterSlotInput {
  slot: number;
  slug: string;
  title: string;
  enabled: boolean;
  imageFile: string;
  /** Full VRChat group id (grp_uuid). Empty/omit when unset. */
  groupId?: string | null;
}

export interface PosterManifest {
  version: number;
  updatedAt: string;
  posters: Array<{
    id: string;
    title: string;
    enabled: boolean;
    slot: number;
    /** Filename under station/posters/ — bake matching VRCUrls in the world. */
    file: string;
    /** Present when the poster should open a VRChat group page. */
    groupId?: string;
  }>;
}

/**
 * Build the public posters.json / station/poster.json payload.
 * Always includes every slot 0..maxSlots-1 in order so indices match baked VRCUrls.
 */
export function buildPosterManifest(
  version: number,
  updatedAt: Date | string,
  slots: PosterSlotInput[],
  maxSlots: number = POSTERS_MAX_SLOTS,
): PosterManifest {
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  const posters: PosterManifest["posters"] = [];

  for (let slot = 0; slot < maxSlots; slot++) {
    const existing = bySlot.get(slot);
    const defaults = DEFAULT_STATION_FRAME_POSTERS.find((p) => p.slot === slot);
    const groupId = normalizePosterGroupId(existing?.groupId);
    const entry: PosterManifest["posters"][number] = {
      id: existing?.slug ?? defaults?.slug ?? `slot-${slot}`,
      title: existing?.title ?? defaults?.title ?? `Slot ${slot}`,
      enabled: existing?.enabled ?? false,
      slot,
      file:
        existing?.imageFile ||
        defaults?.imageFile ||
        frameFileFromSlug(`slot-${slot}`),
    };
    if (groupId) {
      entry.groupId = groupId;
    }
    posters.push(entry);
  }

  return {
    version,
    updatedAt:
      typeof updatedAt === "string" ? updatedAt : updatedAt.toISOString(),
    posters,
  };
}

/** Full `grp_` UUID from vrchat.com (short codes like NAME.1234 are rejected). */
const VRCHAT_GROUP_ID_RE =
  /^grp_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizePosterGroupId(
  input: string | null | undefined,
): string | null {
  if (input === undefined || input === null) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

export function assertValidPosterGroupId(input: string): string {
  const normalized = normalizePosterGroupId(input);
  if (!normalized) {
    throw new Error("Group id cannot be empty.");
  }
  if (!VRCHAT_GROUP_ID_RE.test(normalized)) {
    throw new Error(
      "Invalid VRChat group id. Use the full grp_… UUID from vrchat.com (short codes like NAME.1234 will not work).",
    );
  }
  return normalized;
}

export function isValidPosterGroupId(input: string): boolean {
  try {
    assertValidPosterGroupId(input);
    return true;
  } catch {
    return false;
  }
}

export function frameFileFromSlug(slug: string): string {
  const part = slugifyPosterId(slug).toUpperCase().replace(/-/g, "_");
  return `FRAME_${part}.jpg`;
}

export function posterImageRepoPath(imageFile: string): string {
  return `${POSTERS_IMAGE_DIR}/${imageFile}`;
}

export function posterPublicBaseUrl(owner: string, repo: string): string {
  return `https://${owner}.github.io/${repo}/${POSTERS_STATION_PREFIX}`;
}

export function posterImagePublicUrl(
  owner: string,
  repo: string,
  imageFile: string,
): string {
  return `${posterPublicBaseUrl(owner, repo)}/posters/${imageFile}`;
}

export function posterJsonPublicUrl(owner: string, repo: string): string {
  return `${posterPublicBaseUrl(owner, repo)}/poster.json`;
}

export function slugifyPosterId(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "poster";
}

export function defaultImageFileForSlot(slot: number, slug: string): string {
  const defaults = DEFAULT_STATION_FRAME_POSTERS.find((p) => p.slot === slot);
  if (defaults) {
    return defaults.imageFile;
  }
  return frameFileFromSlug(slug);
}
