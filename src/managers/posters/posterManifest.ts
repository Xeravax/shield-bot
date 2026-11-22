/**
 * Station Community Board posters — VRChat constraints:
 *
 * - JSON is METADATA ONLY. The world ignores image URLs in JSON.
 * - Images are FIXED baked VRCUrls: FRAME_0.jpg … FRAME_{POSTERS_MAX_SLOTS-1}.jpg on GitHub Pages.
 *   The world bakes all of them; poster.json's slotCount says how many it should download.
 * - Udon cannot build VRCUrl from strings, so the slot limit is the number of baked URLs.
 * - api.vrcshield.com is for JSON only — never serve images from it.
 * - Overwrite FRAME_*.jpg in place + bump version when art changes.
 */

/**
 * Janitor of the Month picture: one fixed file next to the posters, baked into the world as
 * ModularItemPickup.pictureUrl. Overwritten in place by /poster jotm-picture; not in poster.json.
 */
export const JOTM_IMAGE_FILE = "FRAME_JOTM.jpg";
/** The board shows a ~0.8 m square; 1024 px is sharp without wasting VRAM. */
export const JOTM_IMAGE_SIZE = 1024;

/** Baked world slots: FRAME_0.jpg … FRAME_19.jpg (20 VRCUrls in the world). */
export const POSTERS_MAX_SLOTS = 20;
/**
 * Worlds uploaded before the numbered scheme bake the named files below for slots 0–6.
 * While true, uploads to those slots also overwrite the named file so old uploads keep
 * working. Set to false once every world uses the numbered URLs.
 */
export const POSTERS_LEGACY_DUAL_WRITE = true;
/** Keep titles short for VRChat Interact prompts. */
export const POSTERS_TITLE_MAX_LENGTH = 40;
export const POSTERS_STATION_PREFIX = "station";
export const POSTERS_JSON_PATH = `${POSTERS_STATION_PREFIX}/poster.json`;
export const POSTERS_IMAGE_DIR = `${POSTERS_STATION_PREFIX}/posters`;

/**
 * LEGACY named files baked into older Station uploads (slots 0–6), and the default
 * titles/slugs for those slots. New files are always FRAME_{slot}.jpg (posterSlotImageFile).
 * Host: https://izuna-chan.github.io/Station_Whitelists/station/posters/
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
  /** Slots 0..slotCount-1 exist (highest slot with an uploaded image + 1). The world only
   *  downloads FRAME_{slot}.jpg for enabled slots below this. */
  slotCount: number;
  posters: Array<{
    slot: number;
    enabled: boolean;
    title: string;
    id: string;
    /** FRAME_{slot}.jpg (the world uses its baked VRCUrl for the slot, not this string). */
    file: string;
    /** Present when Interact should open a VRChat group page. */
    groupId?: string;
  }>;
}

/**
 * Build posters.json / station/poster.json.
 * slotCount = highest slot that has an uploaded image + 1; posters lists every slot below it in
 * order (gaps padded as disabled) so the world knows exactly which FRAME_{slot}.jpg to fetch.
 */
export function buildPosterManifest(
  version: number,
  updatedAt: Date | string,
  slots: PosterSlotInput[],
  maxSlots: number = POSTERS_MAX_SLOTS,
): PosterManifest {
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  const posters: PosterManifest["posters"] = [];

  let slotCount = 0;
  for (const s of slots) {
    if (s.slot >= 0 && s.slot < maxSlots && s.imageFile) {
      slotCount = Math.max(slotCount, s.slot + 1);
    }
  }

  for (let slot = 0; slot < slotCount; slot++) {
    const existing = bySlot.get(slot);
    const defaults = DEFAULT_STATION_FRAME_POSTERS.find((p) => p.slot === slot);
    const groupId = normalizePosterGroupId(existing?.groupId);
    const entry: PosterManifest["posters"][number] = {
      slot,
      // A slot without an uploaded image cannot be shown.
      enabled: Boolean(existing?.enabled && existing.imageFile),
      title: clampPosterTitle(
        existing?.title ?? defaults?.title ?? `Slot ${slot}`,
      ),
      id: existing?.slug ?? defaults?.slug ?? `slot-${slot}`,
      file: posterSlotImageFile(slot),
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
    slotCount,
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

/** The numbered file the world bakes for a slot: FRAME_{slot}.jpg. */
export function posterSlotImageFile(slot: number): string {
  return `FRAME_${slot}.jpg`;
}

/** Named file older Station uploads bake for slots 0–6, or undefined. */
export function legacyImageFileForSlot(slot: number): string | undefined {
  return DEFAULT_STATION_FRAME_POSTERS.find((p) => p.slot === slot)?.imageFile;
}
