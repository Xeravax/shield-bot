import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  createFramedPosterJpeg,
  PosterFrameError,
  POSTER_OUTPUT_SIZE,
} from "./posterFrame.js";

async function tinyPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 64,
      height: 96,
      channels: 3,
      background: { r: 40, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

describe("createFramedPosterJpeg", () => {
  it("produces a 2048x2048 JPEG", async () => {
    const input = await tinyPng();
    const out = await createFramedPosterJpeg(input, "image/png");

    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(out.length).toBeGreaterThan(10_000);
    expect(out.length).toBeLessThan(8 * 1024 * 1024);

    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(POSTER_OUTPUT_SIZE);
    expect(meta.height).toBe(POSTER_OUTPUT_SIZE);
  });

  it("rejects empty uploads", async () => {
    await expect(createFramedPosterJpeg(Buffer.alloc(0))).rejects.toBeInstanceOf(
      PosterFrameError,
    );
  });

  it("rejects unsupported mime types", async () => {
    const input = await tinyPng();
    await expect(
      createFramedPosterJpeg(input, "image/gif"),
    ).rejects.toBeInstanceOf(PosterFrameError);
  });
});
