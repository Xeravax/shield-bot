import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("../../main.js", () => ({ prisma: {} }));

import { PosterManager } from "./posterManager.js";
import { JOTM_IMAGE_FILE, JOTM_IMAGE_SIZE } from "./posterManifest.js";

describe("PosterManager.setJotmPicture", () => {
  it("frames the upload to a 1024 square JPEG and publishes only FRAME_JOTM.jpg", async () => {
    const manager = new PosterManager();
    const publisher = (manager as unknown as { githubPublisher: Record<string, unknown> }).githubPublisher;
    const update = vi.fn().mockResolvedValue({ updated: true, commitSha: "abc1234def", owner: "o", repo: "r" });
    publisher.updateRepositoryWithPosterFiles = update;
    publisher.getPosterRepoSettings = vi.fn().mockResolvedValue({ owner: "izuna-chan", repo: "Station_Whitelists", branch: "main" });

    // 800x400 landscape input: must come out square
    const input = await sharp({ create: { width: 800, height: 400, channels: 3, background: { r: 200, g: 150, b: 40 } } })
      .png()
      .toBuffer();

    const result = await manager.setJotmPicture({
      guildId: "813926536457224212",
      image: input,
      mimeType: "image/png",
      updatedBy: "123",
    });

    expect(update).toHaveBeenCalledTimes(1);
    const args = update.mock.calls[0][0] as { posterJson?: string; imageFile: string; jpegBytes: Buffer };
    expect(args.posterJson).toBeUndefined(); // poster list untouched
    expect(args.imageFile).toBe(JOTM_IMAGE_FILE);
    const meta = await sharp(args.jpegBytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(JOTM_IMAGE_SIZE);
    expect(meta.height).toBe(JOTM_IMAGE_SIZE);
    expect(result.imageUrl).toContain("/posters/FRAME_JOTM.jpg");
    expect(result.commitSha).toBe("abc1234def");
  });

  it("rejects an invalid guild id before doing any work", async () => {
    const manager = new PosterManager();
    await expect(
      manager.setJotmPicture({ guildId: "nope", image: Buffer.from([1]), updatedBy: "1" }),
    ).rejects.toThrow(/guild id/);
  });
});
