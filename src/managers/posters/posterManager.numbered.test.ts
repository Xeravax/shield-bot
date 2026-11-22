import { describe, expect, it, vi, beforeEach } from "vitest";
import sharp from "sharp";

const db = vi.hoisted(() => ({
  posters: [] as Array<Record<string, unknown>>,
  stateUpsert: vi.fn(),
  stateUpdate: vi.fn(),
  stateFind: vi.fn(),
  posterUpsert: vi.fn(),
  posterUpdate: vi.fn(),
  posterFindMany: vi.fn(),
  posterFindUnique: vi.fn(),
}));

vi.mock("../../main.js", () => ({
  prisma: {
    communityPosterState: { upsert: db.stateUpsert, update: db.stateUpdate, findUniqueOrThrow: db.stateFind },
    communityPoster: {
      upsert: db.posterUpsert,
      update: db.posterUpdate,
      findMany: db.posterFindMany,
      findUnique: db.posterFindUnique,
    },
  },
}));

import { PosterManager } from "./posterManager.js";

const GID = "813926536457224212";

function setup() {
  const manager = new PosterManager();
  const publisher = (manager as unknown as { githubPublisher: Record<string, unknown> }).githubPublisher;
  const update = vi.fn().mockResolvedValue({ updated: true, commitSha: "c0ffee1", owner: "o", repo: "r" });
  publisher.updateRepositoryWithPosterFiles = update;
  publisher.getPosterRepoSettings = vi.fn().mockResolvedValue({ owner: "izuna-chan", repo: "Station_Whitelists", branch: "main" });
  return { manager, update };
}

describe("PosterManager numbered files", () => {
  beforeEach(() => {
    Object.values(db).forEach((v) => typeof v === "function" && (v as ReturnType<typeof vi.fn>).mockReset());
    db.stateUpsert.mockResolvedValue({});
    db.stateUpdate.mockResolvedValue({ version: 31 });
    db.stateFind.mockResolvedValue({ version: 31, updatedAt: new Date("2026-11-22T00:00:00Z") });
    db.posterUpsert.mockResolvedValue({});
    db.posterUpdate.mockResolvedValue({});
  });

  it("seeds only the seven original slots", async () => {
    const { manager } = setup();
    await manager.ensureSeeded(GID);
    expect(db.posterUpsert).toHaveBeenCalledTimes(7);
  });

  it("uploads to FRAME_{slot}.jpg and dual-writes the legacy name for slots 0-6", async () => {
    const { manager, update } = setup();
    db.posterFindUnique.mockResolvedValue({ slot: 2, slug: "kus", title: "KUS", groupId: "" });
    db.posterFindMany.mockResolvedValue([{ slot: 2, slug: "kus", title: "KUS", enabled: true, imageFile: "FRAME_2.jpg", groupId: "" }]);
    const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#fff" } }).png().toBuffer();

    const result = await manager.setPoster({ guildId: GID, slot: 2, image, mimeType: "image/png", updatedBy: "1" });

    const args = update.mock.calls[0][0] as { imageFile: string; extraImageFiles?: string[]; posterJson: string };
    expect(args.imageFile).toBe("FRAME_2.jpg");
    expect(args.extraImageFiles).toEqual(["FRAME_KUS.jpg"]);
    expect(JSON.parse(args.posterJson).slotCount).toBe(3);
    expect(result.imageUrl).toContain("/posters/FRAME_2.jpg");
  });

  it("uploads to a new high slot without a legacy copy", async () => {
    const { manager, update } = setup();
    db.posterFindUnique.mockResolvedValue(null);
    db.posterFindMany.mockResolvedValue([{ slot: 12, slug: "new", title: "New", enabled: true, imageFile: "FRAME_12.jpg", groupId: "" }]);
    const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#000" } }).png().toBuffer();

    await manager.setPoster({ guildId: GID, slot: 12, title: "New", image, mimeType: "image/png", updatedBy: "1" });

    const args = update.mock.calls[0][0] as { imageFile: string; extraImageFiles?: string[]; posterJson: string };
    expect(args.imageFile).toBe("FRAME_12.jpg");
    expect(args.extraImageFiles).toBeUndefined();
    expect(JSON.parse(args.posterJson).slotCount).toBe(13);
  });

  it("migrates named files by copying first, then updating the DB and poster.json", async () => {
    const { manager, update } = setup();
    db.posterFindMany
      .mockResolvedValueOnce([
        { slot: 0, imageFile: "FRAME_COBALT.jpg" },
        { slot: 1, imageFile: "FRAME_1.jpg" },
        { slot: 5, imageFile: "FRAME_PRIDEVR.jpg" },
      ])
      .mockResolvedValue([
        { slot: 0, slug: "cobalt", title: "Cobalt", enabled: true, imageFile: "FRAME_0.jpg", groupId: "" },
        { slot: 1, slug: "hoppu", title: "Hoppu", enabled: true, imageFile: "FRAME_1.jpg", groupId: "" },
        { slot: 5, slug: "pridevr", title: "PrideVR", enabled: true, imageFile: "FRAME_5.jpg", groupId: "" },
      ]);

    const result = await manager.migrateFilesToNumbered(GID, "1");

    expect(result.copied).toEqual([
      { slot: 0, from: "FRAME_COBALT.jpg", to: "FRAME_0.jpg" },
      { slot: 5, from: "FRAME_PRIDEVR.jpg", to: "FRAME_5.jpg" },
    ]);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][0]).toMatchObject({ copies: [
      { from: "FRAME_COBALT.jpg", to: "FRAME_0.jpg" },
      { from: "FRAME_PRIDEVR.jpg", to: "FRAME_5.jpg" },
    ] });
    expect(update.mock.calls[0][0]).not.toHaveProperty("posterJson");
    expect(db.posterUpdate).toHaveBeenCalledTimes(2);
    expect(JSON.parse(update.mock.calls[1][0].posterJson).slotCount).toBe(6);
  });
});
