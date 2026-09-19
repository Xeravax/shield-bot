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
  it("emits world-consumed fields and pads baked slots", () => {
    const manifest = buildPosterManifest(
      3,
      "2026-09-19T14:00:00.000Z",
      [
        {
          slot: 0,
          slug: "cobalt",
          title: "Cobalt",
          enabled: true,
          imageFile: "FRAME_COBALT.jpg",
        },
      ],
      3,
    );

    expect(manifest.version).toBe(3);
    expect(manifest.posters[0]).toMatchObject({
      slot: 0,
      enabled: true,
      title: "Cobalt",
      file: "FRAME_COBALT.jpg",
    });
    expect(manifest.posters[0]).not.toHaveProperty("imageUrl");
    expect(manifest.posters[1].file).toBe("FRAME_HOPPU.jpg");
    expect(manifest.posters[2].file).toBe("FRAME_KUS.jpg");
  });

  it("keeps disabled slots in the array", () => {
    const manifest = buildPosterManifest(1, new Date("2026-01-01T00:00:00.000Z"), [
      {
        slot: 0,
        slug: "a",
        title: "A",
        enabled: false,
        imageFile: "FRAME_COBALT.jpg",
      },
      {
        slot: 1,
        slug: "b",
        title: "B",
        enabled: true,
        imageFile: "FRAME_HOPPU.jpg",
      },
    ], 2);

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

describe("DEFAULT_STATION_FRAME_POSTERS", () => {
  it("maps the seven baked FRAME_*.jpg files to slots 0-6", () => {
    expect(POSTERS_MAX_SLOTS).toBe(7);
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
