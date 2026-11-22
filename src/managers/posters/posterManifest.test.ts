import { describe, expect, it } from "vitest";
import {
  assertPosterTitle,
  buildPosterManifest,
  DEFAULT_STATION_FRAME_POSTERS,
  POSTERS_MAX_SLOTS,
  POSTERS_TITLE_MAX_LENGTH,
  posterImagePublicUrl,
  posterJsonPublicUrl,
  slugifyPosterId,
} from "./posterManifest.js";

describe("buildPosterManifest", () => {
  it("emits world-consumed fields with numbered files", () => {
    const manifest = buildPosterManifest(3, "2026-09-19T14:00:00.000Z", [
      { slot: 0, slug: "cobalt", title: "Cobalt", enabled: true, imageFile: "FRAME_0.jpg" },
    ]);

    expect(manifest.version).toBe(3);
    expect(manifest.slotCount).toBe(1);
    expect(manifest.posters).toHaveLength(1);
    expect(manifest.posters[0]).toMatchObject({ slot: 0, enabled: true, title: "Cobalt", file: "FRAME_0.jpg" });
    expect(manifest.posters[0]).not.toHaveProperty("imageUrl");
  });

  it("sets slotCount to the highest slot with an image and pads gaps as disabled", () => {
    const manifest = buildPosterManifest(1, "2026-01-01T00:00:00.000Z", [
      { slot: 0, slug: "a", title: "A", enabled: true, imageFile: "FRAME_0.jpg" },
      { slot: 4, slug: "e", title: "E", enabled: true, imageFile: "FRAME_4.jpg" },
      { slot: 9, slug: "j", title: "J", enabled: true, imageFile: "" }, // no image yet
    ]);

    expect(manifest.slotCount).toBe(5);
    expect(manifest.posters.map((p) => p.slot)).toEqual([0, 1, 2, 3, 4]);
    expect(manifest.posters.map((p) => p.enabled)).toEqual([true, false, false, false, true]);
    expect(manifest.posters[2].file).toBe("FRAME_2.jpg");
  });

  it("never counts slots beyond the baked maximum", () => {
    const manifest = buildPosterManifest(1, "2026-01-01T00:00:00.000Z", [
      { slot: POSTERS_MAX_SLOTS, slug: "x", title: "X", enabled: true, imageFile: "FRAME_99.jpg" },
    ]);
    expect(manifest.slotCount).toBe(0);
    expect(manifest.posters).toEqual([]);
  });

  it("keeps disabled slots in the array", () => {
    const manifest = buildPosterManifest(1, new Date("2026-01-01T00:00:00.000Z"), [
      {
        slot: 0,
        slug: "a",
        title: "A",
        enabled: false,
        imageFile: "FRAME_0.jpg",
      },
      {
        slot: 1,
        slug: "b",
        title: "B",
        enabled: true,
        imageFile: "FRAME_1.jpg",
      },
    ]);

    expect(manifest.posters[0].enabled).toBe(false);
    expect(manifest.posters[1].enabled).toBe(true);
    expect(manifest.version).toBe(1);
  });
});

describe("poster URL helpers", () => {
  it("builds Station_Whitelists Pages paths with official FRAME names", () => {
    expect(
      posterImagePublicUrl(
        "izuna-chan",
        "Station_Whitelists",
        "FRAME_COBALT.jpg",
      ),
    ).toBe(
      "https://izuna-chan.github.io/Station_Whitelists/station/posters/FRAME_COBALT.jpg",
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

describe("slot files", () => {
  it("numbers every slot and keeps the legacy names for slots 0-6", async () => {
    const { posterSlotImageFile, legacyImageFileForSlot } = await import("./posterManifest.js");
    expect(POSTERS_MAX_SLOTS).toBe(20);
    expect(posterSlotImageFile(0)).toBe("FRAME_0.jpg");
    expect(posterSlotImageFile(19)).toBe("FRAME_19.jpg");
    expect(legacyImageFileForSlot(5)).toBe("FRAME_PRIDEVR.jpg");
    expect(legacyImageFileForSlot(7)).toBeUndefined();
  });
});

describe("DEFAULT_STATION_FRAME_POSTERS", () => {
  it("lists the seven legacy named files for slots 0-6", () => {
    expect(DEFAULT_STATION_FRAME_POSTERS).toHaveLength(7);
    expect(DEFAULT_STATION_FRAME_POSTERS.map((p) => p.imageFile)).toEqual([
      "FRAME_COBALT.jpg",
      "FRAME_HOPPU.jpg",
      "FRAME_KUS.jpg",
      "FRAME_LAB.jpg",
      "FRAME_MPS.jpg",
      "FRAME_PRIDEVR.jpg",
      "FRAME_PSI.jpg",
    ]);
  });
});

describe("poster title limits", () => {
  it("rejects titles longer than Interact limit", () => {
    expect(assertPosterTitle("Cobalt")).toBe("Cobalt");
    expect(() =>
      assertPosterTitle("x".repeat(POSTERS_TITLE_MAX_LENGTH + 1)),
    ).toThrow(/40/);
  });
});

describe("poster groupId", () => {
  it("includes groupId only when set", async () => {
    const { assertValidPosterGroupId, buildPosterManifest } = await import(
      "./posterManifest.js"
    );
    const id = "grp_12345678-1234-1234-1234-123456789abc";
    expect(assertValidPosterGroupId(id)).toBe(id);
    expect(() => assertValidPosterGroupId("COBALT.1234")).toThrow(/grp_/);

    const withGroup = buildPosterManifest(1, "2026-01-01T00:00:00.000Z", [
      {
        slot: 0,
        slug: "cobalt",
        title: "Cobalt",
        enabled: true,
        imageFile: "FRAME_COBALT.jpg",
        groupId: id,
      },
    ], 1);
    expect(withGroup.posters[0].groupId).toBe(id);

    const without = buildPosterManifest(1, "2026-01-01T00:00:00.000Z", [
      {
        slot: 0,
        slug: "cobalt",
        title: "Cobalt",
        enabled: true,
        imageFile: "FRAME_COBALT.jpg",
        groupId: "",
      },
    ], 1);
    expect(without.posters[0].groupId).toBeUndefined();
  });
});
