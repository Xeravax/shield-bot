import sharp from "sharp";

export const POSTER_OUTPUT_SIZE = 2048;
export const POSTER_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Background scale 200% + blur intensity 20 (squareimage.run blurred-frame). */
const BACKGROUND_SCALE = 2;
const BLUR_SIGMA = 20;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export class PosterFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PosterFrameError";
  }
}

export function assertAllowedPosterUpload(
  buffer: Buffer,
  mimeType?: string | null,
): void {
  if (!buffer || buffer.length === 0) {
    throw new PosterFrameError("Image upload is empty.");
  }
  if (buffer.length > POSTER_MAX_UPLOAD_BYTES) {
    throw new PosterFrameError(
      `Image exceeds maximum size of ${POSTER_MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`,
    );
  }
  if (mimeType) {
    const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (normalized && !ALLOWED_MIME.has(normalized)) {
      throw new PosterFrameError(
        "Unsupported image type. Upload PNG, JPEG, or WebP.",
      );
    }
  }
}

/**
 * Produce a 2048x2048 full-bleed framed JPEG matching FRAME_* / blurred-frame settings:
 * - 1:1 canvas
 * - background: cover-scaled to 200% + blur 20
 * - main: contain-fit at 100% (letterbox blur bars)
 */
export async function createFramedPosterJpeg(
  input: Buffer,
  mimeType?: string | null,
): Promise<Buffer> {
  assertAllowedPosterUpload(input, mimeType);

  const size = POSTER_OUTPUT_SIZE;
  const bgSize = Math.round(size * BACKGROUND_SCALE);

  try {
    await sharp(input, { failOn: "none" }).rotate().metadata();
  } catch {
    throw new PosterFrameError("Could not decode image.");
  }

  const background = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(bgSize, bgSize, { fit: "cover", position: "centre" })
    .blur(BLUR_SIGMA)
    .modulate({ brightness: 0.85 })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  const main = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const framed = await sharp(background)
    .resize(size, size, { fit: "cover", position: "centre" })
    .composite([{ input: main, gravity: "centre" }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  return framed;
}
