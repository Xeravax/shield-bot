import { describe, expect, it } from "vitest";
import {
  buildPosterManifest,
  posterImagePublicUrl,
  posterJsonPublicUrl,
  slugifyPosterId,
} from "./posterManifest.js";

describe("buildPosterManifest", () => {
  it("pads every slot in order with disabled defaults", () => {
    const manifest = buildPosterManifest(
      3,
      "2026-09-19T14:00:00.000Z",
      [{ slot: 0, slug: "cobalt", title: "Cobalt Conclave", enabled: true }],
      3,
    );

    expect(manifest).toEqual({
      version: 3,
      updatedAt: "2026-09-19T14:00:00.000Z",
      posters: [
        {
          id: "cobalt",
          title: "Cobalt Conclave",
          enabled: true,
          slot: 0,
        },
        { id: "slot-1", title: "Slot 1", enabled: false, slot: 1 },
        { id: "slot-2", title: "Slot 2", enabled: false, slot: 2 },
      ],
    });
  });

  it("keeps disabled slots in the array", () => {
    const manifest = buildPosterManifest(1, new Date("2026-01-01T00:00:00.000Z"), [
      { slot: 0, slug: "a", title: "A", enabled: false },
      { slot: 1, slug: "b", title: "B", enabled: true },
    ], 2);

    expect(manifest.posters[0].enabled).toBe(false);
    expect(manifest.posters[1].enabled).toBe(true);
    expect(manifest.version).toBe(1);
  });
});

describe("poster URL helpers", () => {
  it("builds Station_Whitelists Pages paths", () => {
    expect(posterImagePublicUrl("izuna-chan", "Station_Whitelists", 0)).toBe(
      "https://izuna-chan.github.io/Station_Whitelists/station/posters/0.jpg",
    );
    expect(posterJsonPublicUrl("izuna-chan", "Station_Whitelists")).toBe(
      "https://izuna-chan.github.io/Station_Whitelists/station/poster.json",
    );
  });
});

describe("slugifyPosterId", () => {
  it("normalizes titles into slugs", () => {
    expect(slugifyPosterId("Cobalt Conclave")).toBe("cobalt-conclave");
    expect(slugifyPosterId("  Hello!!! World  ")).toBe("hello-world");
  });
});
