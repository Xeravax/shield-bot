/**
 * Station Community Board posters — VRChat constraints:
 *
 * - JSON is METADATA ONLY. The world ignores image URLs in JSON.
 * - Images are FIXED baked VRCUrls (FRAME_*.jpg on GitHub Pages).
 * - Udon cannot build VRCUrl from strings; new slots need a world re-upload.
 * - api.vrcshield.com is for JSON only — never serve images from it.
 * - Overwrite FRAME_*.jpg in place + bump version when art changes.
 */

/** Baked world slots are 0–6 (seven FRAME_*.jpg files). */
export const POSTERS_MAX_SLOTS = 7;
/** Keep titles short for VRChat Interact prompts. */
export const POSTERS_TITLE_MAX_LENGTH = 40;
export const POSTERS_STATION_PREFIX = "station";
export const POSTERS_JSON_PATH = `${POSTERS_STATION_PREFIX}/poster.json`;
export const POSTERS_IMAGE_DIR = `${POSTERS_STATION_PREFIX}/posters`;

/**
 * Fixed allowlisted image paths already baked into the Station world.
 * Host: https://izuna-chan.github.io/Station_Whitelists/station/posters/
 * Bot must overwrite these exact filenames — never invent per-request URLs.
 */
export const DEFAULT_STATION_FRAME_POSTERS = [
  {
    slot: 0,
    slug: "cobalt",
    title: "Cobalt",
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

/**
 * Public JSON contract consumed by the world:
 * version, posters[].slot, enabled, title, groupId?
 * Extra fields (id, file, updatedAt) are ignored by Udon but useful for staff.
 */
export interface PosterManifest {
  version: number;
  updatedAt: string;
  posters: Array<{
    slot: number;
    enabled: boolean;
    title: string;
    id: string;
    /** Fixed FRAME_*.jpg filename (world uses baked VRCUrl, not this string). */
    file: string;
    /** Present when Interact should open a VRChat group page. */
    groupId?: string;
  }>;
}

/**
 * Build posters.json / station/poster.json.
 * Always includes every baked slot 0..6 in order.
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
      slot,
      enabled: existing?.enabled ?? false,
      title: clampPosterTitle(
        existing?.title ?? defaults?.title ?? `Slot ${slot}`,
      ),
      id: existing?.slug ?? defaults?.slug ?? `slot-${slot}`,
      file:
        defaults?.imageFile ||
        existing?.imageFile ||
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

export function clampPosterTitle(title: string): string {
  const trimmed = title.trim().replace(/\s+/g, " ");
  if (trimmed.length <= POSTERS_TITLE_MAX_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, POSTERS_TITLE_MAX_LENGTH).trimEnd();
}

export function assertPosterTitle(title: string): string {
  const trimmed = title.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    throw new Error("Title cannot be empty.");
  }
  if (trimmed.length > POSTERS_TITLE_MAX_LENGTH) {
    throw new Error(
      `Title must be at most ${POSTERS_TITLE_MAX_LENGTH} characters (Interact prompt limit).`,
    );
  }
  return trimmed;
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

/** Always the baked FRAME_*.jpg for slots 0–6. */
export function defaultImageFileForSlot(slot: number, slug: string): string {
  const defaults = DEFAULT_STATION_FRAME_POSTERS.find((p) => p.slot === slot);
  if (defaults) {
    return defaults.imageFile;
  }
  return frameFileFromSlug(slug);
}
