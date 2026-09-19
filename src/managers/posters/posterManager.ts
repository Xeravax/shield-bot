import { prisma } from "../../main.js";
import { loggers } from "../../utility/logger.js";
import { GitHubPublisher } from "../whitelist/githubPublisher.js";
import {
  createFramedPosterJpeg,
  PosterFrameError,
} from "./posterFrame.js";
import {
  assertPosterTitle,
  assertValidPosterGroupId,
  buildPosterManifest,
  DEFAULT_STATION_FRAME_POSTERS,
  defaultImageFileForSlot,
  posterImagePublicUrl,
  posterJsonPublicUrl,
  POSTERS_MAX_SLOTS,
  slugifyPosterId,
  type PosterManifest,
} from "./posterManifest.js";

export { PosterFrameError };

export class PosterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PosterValidationError";
  }
}

function parseOptionalGroupId(
  input: string | null | undefined,
  opts?: { allowClear?: boolean },
): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (input === null || input.trim() === "") {
    if (opts?.allowClear === false) {
      throw new PosterValidationError("Group id cannot be empty.");
    }
    return "";
  }
  try {
    return assertValidPosterGroupId(input);
  } catch (error) {
    throw new PosterValidationError(
      error instanceof Error ? error.message : "Invalid group id.",
    );
  }
}

let publishChain: Promise<unknown> = Promise.resolve();

function withPublishLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = publishChain.then(fn, fn);
  publishChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function assertGuildId(guildId: string | undefined | null): string {
  if (!guildId || !/^\d{17,20}$/.test(guildId)) {
    throw new PosterValidationError("A valid guild id is required.");
  }
  return guildId;
}

export class PosterManager {
  private githubPublisher = new GitHubPublisher();

  async ensureSeeded(guildId: string): Promise<void> {
    const gid = assertGuildId(guildId);

    await prisma.communityPosterState.upsert({
      where: { guildId: gid },
      create: { guildId: gid, version: 0 },
      update: {},
    });

    const defaultsBySlot = new Map<
      number,
      (typeof DEFAULT_STATION_FRAME_POSTERS)[number]
    >(DEFAULT_STATION_FRAME_POSTERS.map((p) => [p.slot, p]));

    for (let slot = 0; slot < POSTERS_MAX_SLOTS; slot++) {
      const defaults = defaultsBySlot.get(slot);
      await prisma.communityPoster.upsert({
        where: { guildId_slot: { guildId: gid, slot } },
        create: {
          guildId: gid,
          slot,
          slug: defaults?.slug ?? `slot-${slot}`,
          title: defaults?.title ?? `Slot ${slot}`,
          imageFile: defaults?.imageFile ?? "",
          // Existing FRAME_*.jpg files are already on GitHub — enable by default.
          enabled: Boolean(defaults),
        },
        update: {},
      });
    }
  }

  async getManifest(guildId: string): Promise<PosterManifest> {
    const gid = assertGuildId(guildId);
    await this.ensureSeeded(gid);

    const [state, posters] = await Promise.all([
      prisma.communityPosterState.findUniqueOrThrow({ where: { guildId: gid } }),
      prisma.communityPoster.findMany({
        where: { guildId: gid },
        orderBy: { slot: "asc" },
      }),
    ]);

    return buildPosterManifest(
      state.version,
      state.updatedAt,
      posters.map((p) => ({
        slot: p.slot,
        slug: p.slug,
        title: p.title,
        enabled: p.enabled,
        imageFile: p.imageFile,
        groupId: p.groupId,
      })),
    );
  }

  async getManifestJson(guildId: string): Promise<string> {
    return `${JSON.stringify(await this.getManifest(guildId), null, 2)}\n`;
  }

  private async resolveRepo(guildId: string): Promise<{
    owner: string;
    repo: string;
  }> {
    return this.githubPublisher.getPosterRepoSettings(guildId);
  }

  imagePublicUrl(owner: string, repo: string, imageFile: string): string {
    return posterImagePublicUrl(owner, repo, imageFile);
  }

  async listForStaff(guildId: string): Promise<{
    version: number;
    updatedAt: string;
    jsonUrl: string;
    posters: Array<{
      slot: number;
      id: string;
      title: string;
      enabled: boolean;
      file: string;
      imageUrl: string;
      groupId: string | null;
    }>;
  }> {
    const gid = assertGuildId(guildId);
    const manifest = await this.getManifest(gid);
    const { owner, repo } = await this.resolveRepo(gid);
    return {
      version: manifest.version,
      updatedAt: manifest.updatedAt,
      jsonUrl: posterJsonPublicUrl(owner, repo),
      posters: manifest.posters.map((p) => ({
        slot: p.slot,
        id: p.id,
        title: p.title,
        enabled: p.enabled,
        file: p.file,
        imageUrl: posterImagePublicUrl(owner, repo, p.file),
        groupId: p.groupId ?? null,
      })),
    };
  }

  private assertSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= POSTERS_MAX_SLOTS) {
      throw new PosterValidationError(
        `Slot must be an integer from 0 to ${POSTERS_MAX_SLOTS - 1} (baked world slots only).`,
      );
    }
  }

  private assertTitle(title: string): string {
    try {
      return assertPosterTitle(title);
    } catch (error) {
      throw new PosterValidationError(
        error instanceof Error ? error.message : "Invalid title.",
      );
    }
  }

  async setPoster(options: {
    guildId: string;
    slot: number;
    title: string;
    id?: string | null;
    groupId?: string | null;
    image: Buffer;
    mimeType?: string | null;
    updatedBy: string;
    commitMessage?: string;
  }): Promise<{
    manifest: PosterManifest;
    imageUrl: string;
    commitSha?: string;
  }> {
    const gid = assertGuildId(options.guildId);
    this.assertSlot(options.slot);
    const title = this.assertTitle(options.title);

    const slug = slugifyPosterId(options.id?.trim() || title);
    const groupIdUpdate = parseOptionalGroupId(options.groupId);
    const jpeg = await createFramedPosterJpeg(options.image, options.mimeType);

    return withPublishLock(async () => {
      await this.ensureSeeded(gid);

      // Always overwrite the fixed baked FRAME_*.jpg path for this slot.
      const imageFile = defaultImageFileForSlot(options.slot, slug);

      await prisma.communityPoster.upsert({
        where: { guildId_slot: { guildId: gid, slot: options.slot } },
        create: {
          guildId: gid,
          slot: options.slot,
          slug,
          title,
          imageFile,
          groupId: groupIdUpdate ?? "",
          enabled: true,
          updatedBy: options.updatedBy,
        },
        update: {
          slug,
          title,
          imageFile,
          ...(groupIdUpdate !== undefined ? { groupId: groupIdUpdate } : {}),
          enabled: true,
          updatedBy: options.updatedBy,
        },
      });

      const state = await prisma.communityPosterState.update({
        where: { guildId: gid },
        data: { version: { increment: 1 } },
      });

      const manifest = await this.getManifest(gid);
      const posterJson = `${JSON.stringify(manifest, null, 2)}\n`;

      const publish = await this.githubPublisher.updateRepositoryWithPosterFiles({
        guildId: gid,
        posterJson,
        imageFile,
        jpegBytes: jpeg,
        commitMessage:
          options.commitMessage ??
          `chore(posters): set ${imageFile} (slot ${options.slot}) v${state.version}`,
      });

      const { owner, repo } = await this.resolveRepo(gid);
      const imageUrl = posterImagePublicUrl(owner, repo, imageFile);
      loggers.bot.info(
        `Poster ${imageFile} published for guild ${gid} (v${state.version}, commit ${publish.commitSha})`,
      );

      return {
        manifest,
        imageUrl,
        commitSha: publish.commitSha,
      };
    });
  }

  async updatePosterMeta(options: {
    guildId: string;
    slot: number;
    enabled?: boolean;
    title?: string;
    id?: string | null;
    /** Set to a grp_ UUID, or empty string / null to clear. */
    groupId?: string | null;
    updatedBy: string;
    commitMessage?: string;
  }): Promise<{
    manifest: PosterManifest;
    imageUrl: string;
    commitSha?: string;
  }> {
    const gid = assertGuildId(options.guildId);
    this.assertSlot(options.slot);

    return withPublishLock(async () => {
      await this.ensureSeeded(gid);

      const existing = await prisma.communityPoster.findUnique({
        where: { guildId_slot: { guildId: gid, slot: options.slot } },
      });
      if (!existing) {
        throw new PosterValidationError(`Slot ${options.slot} does not exist.`);
      }

      const title =
        options.title !== undefined
          ? this.assertTitle(options.title)
          : existing.title;
      if (options.title !== undefined && !title) {
        throw new PosterValidationError("Title cannot be empty.");
      }

      const slug =
        options.id !== undefined && options.id !== null
          ? slugifyPosterId(options.id.trim() || title)
          : options.title !== undefined
            ? slugifyPosterId(title)
            : existing.slug;

      const groupIdUpdate = parseOptionalGroupId(options.groupId);

      const data: {
        enabled?: boolean;
        title?: string;
        slug?: string;
        groupId?: string;
        updatedBy: string;
      } = { updatedBy: options.updatedBy };

      if (options.enabled !== undefined) {
        data.enabled = options.enabled;
      }
      if (options.title !== undefined) {
        data.title = title;
        data.slug = slug;
      }
      if (options.id !== undefined && options.id !== null) {
        data.slug = slugifyPosterId(options.id.trim() || title);
      }
      if (groupIdUpdate !== undefined) {
        data.groupId = groupIdUpdate;
      }

      await prisma.communityPoster.update({
        where: { guildId_slot: { guildId: gid, slot: options.slot } },
        data,
      });

      const state = await prisma.communityPosterState.update({
        where: { guildId: gid },
        data: { version: { increment: 1 } },
      });

      const manifest = await this.getManifest(gid);
      const posterJson = `${JSON.stringify(manifest, null, 2)}\n`;

      // Metadata only — never touch existing JPEG files.
      const publish = await this.githubPublisher.updateRepositoryWithPosterFiles({
        guildId: gid,
        posterJson,
        commitMessage:
          options.commitMessage ??
          `chore(posters): update slot ${options.slot} metadata v${state.version}`,
      });

      const file =
        existing.imageFile ||
        defaultImageFileForSlot(options.slot, existing.slug);
      const { owner, repo } = await this.resolveRepo(gid);
      return {
        manifest,
        imageUrl: posterImagePublicUrl(owner, repo, file),
        commitSha: publish.commitSha,
      };
    });
  }

  async forceUpdate(
    guildId: string,
    commitMessage?: string,
  ): Promise<{
    manifest: PosterManifest;
    commitSha?: string;
    jsonUrl: string;
  }> {
    const gid = assertGuildId(guildId);

    return withPublishLock(async () => {
      await this.ensureSeeded(gid);
      const manifest = await this.getManifest(gid);
      const posterJson = `${JSON.stringify(manifest, null, 2)}\n`;

      // JSON only — existing FRAME_*.jpg stay as-is on GitHub.
      const publish = await this.githubPublisher.updateRepositoryWithPosterFiles({
        guildId: gid,
        posterJson,
        commitMessage:
          commitMessage ??
          `chore(posters): force update poster.json v${manifest.version}`,
      });

      const { owner, repo } = await this.resolveRepo(gid);
      return {
        manifest,
        commitSha: publish.commitSha,
        jsonUrl: posterJsonPublicUrl(owner, repo),
      };
    });
  }

  /**
   * Point DB slots at existing FRAME_*.jpg names and publish poster.json only.
   * Does not upload or rewrite any JPEG files.
   */
  async seedOfficialFrames(
    guildId: string,
    updatedBy: string,
  ): Promise<{
    manifest: PosterManifest;
    commitSha?: string;
    posters: Array<{ slot: number; file: string; imageUrl: string }>;
  }> {
    const gid = assertGuildId(guildId);

    return withPublishLock(async () => {
      await this.ensureSeeded(gid);

      for (const frame of DEFAULT_STATION_FRAME_POSTERS) {
        await prisma.communityPoster.upsert({
          where: { guildId_slot: { guildId: gid, slot: frame.slot } },
          create: {
            guildId: gid,
            slot: frame.slot,
            slug: frame.slug,
            title: frame.title,
            imageFile: frame.imageFile,
            enabled: true,
            updatedBy,
          },
          update: {
            slug: frame.slug,
            title: frame.title,
            imageFile: frame.imageFile,
            enabled: true,
            updatedBy,
          },
        });
      }

      const state = await prisma.communityPosterState.update({
        where: { guildId: gid },
        data: { version: { increment: 1 } },
      });

      const manifest = await this.getManifest(gid);
      const posterJson = `${JSON.stringify(manifest, null, 2)}\n`;

      const publish = await this.githubPublisher.updateRepositoryWithPosterFiles({
        guildId: gid,
        posterJson,
        commitMessage: `chore(posters): seed official FRAME_* metadata v${state.version}`,
      });

      const { owner, repo } = await this.resolveRepo(gid);
      loggers.bot.info(
        `Seeded official FRAME posters for guild ${gid} (v${state.version}, JSON only)`,
      );

      return {
        manifest,
        commitSha: publish.commitSha,
        posters: DEFAULT_STATION_FRAME_POSTERS.map((frame) => ({
          slot: frame.slot,
          file: frame.imageFile,
          imageUrl: posterImagePublicUrl(owner, repo, frame.imageFile),
        })),
      };
    });
  }
}

export const posterManager = new PosterManager();
