export const POSTERS_MAX_SLOTS = 8;
export const POSTERS_STATION_PREFIX = "station";
export const POSTERS_JSON_PATH = `${POSTERS_STATION_PREFIX}/poster.json`;
export const POSTERS_IMAGE_DIR = `${POSTERS_STATION_PREFIX}/posters`;

export interface PosterSlotInput {
  slot: number;
  slug: string;
  title: string;
  enabled: boolean;
}

export interface PosterManifest {
  version: number;
  updatedAt: string;
  posters: Array<{
    id: string;
    title: string;
    enabled: boolean;
    slot: number;
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
    posters.push({
      id: existing?.slug ?? `slot-${slot}`,
      title: existing?.title ?? `Slot ${slot}`,
      enabled: existing?.enabled ?? false,
      slot,
    });
  }

  return {
    version,
    updatedAt:
      typeof updatedAt === "string" ? updatedAt : updatedAt.toISOString(),
    posters,
  };
}

export function posterImageRepoPath(slot: number): string {
  return `${POSTERS_IMAGE_DIR}/${slot}.jpg`;
}

export function posterPublicBaseUrl(owner: string, repo: string): string {
  return `https://${owner}.github.io/${repo}/${POSTERS_STATION_PREFIX}`;
}

export function posterImagePublicUrl(
  owner: string,
  repo: string,
  slot: number,
): string {
  return `${posterPublicBaseUrl(owner, repo)}/posters/${slot}.jpg`;
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
