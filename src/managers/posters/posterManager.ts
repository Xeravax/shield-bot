import { prisma } from "../../main.js";
import { loggers } from "../../utility/logger.js";
import { GitHubPublisher } from "../whitelist/githubPublisher.js";
import {
  createFramedPosterJpeg,
  PosterFrameError,
} from "./posterFrame.js";
import {
  buildPosterManifest,
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

    for (let slot = 0; slot < POSTERS_MAX_SLOTS; slot++) {
      await prisma.communityPoster.upsert({
        where: { guildId_slot: { guildId: gid, slot } },
        create: {
          guildId: gid,
          slot,
          slug: `slot-${slot}`,
          title: `Slot ${slot}`,
          enabled: false,
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
      })),
    );
  }

  async getManifestJson(guildId: string): Promise<string> {
    return `${JSON.stringify(await this.getManifest(guildId), null, 2)}\n`;
  }

  async getPublicUrls(guildId: string): Promise<{
    owner: string;
    repo: string;
    jsonUrl: string;
    imageUrl: (slot: number) => string;
  }> {
    const gid = assertGuildId(guildId);
    const { owner, repo } =
      await this.githubPublisher.getPosterRepoSettings(gid);
    return {
      owner,
      repo,
      jsonUrl: posterJsonPublicUrl(owner, repo),
      imageUrl: (slot: number) => posterImagePublicUrl(owner, repo, slot),
    };
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
      imageUrl: string;
    }>;
  }> {
    const gid = assertGuildId(guildId);
    const manifest = await this.getManifest(gid);
    const urls = await this.getPublicUrls(gid);
    return {
      version: manifest.version,
      updatedAt: manifest.updatedAt,
      jsonUrl: urls.jsonUrl,
      posters: manifest.posters.map((p) => ({
        slot: p.slot,
        id: p.id,
        title: p.title,
        enabled: p.enabled,
        imageUrl: urls.imageUrl(p.slot),
      })),
    };
  }

  private assertSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= POSTERS_MAX_SLOTS) {
      throw new PosterValidationError(
        `Slot must be an integer from 0 to ${POSTERS_MAX_SLOTS - 1}.`,
      );
    }
  }

  async setPoster(options: {
    guildId: string;
    slot: number;
    title: string;
    id?: string | null;
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
    const title = options.title.trim();
    if (!title) {
      throw new PosterValidationError("Title cannot be empty.");
    }

    const slug = slugifyPosterId(options.id?.trim() || title);
    const jpeg = await createFramedPosterJpeg(options.image, options.mimeType);

    return withPublishLock(async () => {
      await this.ensureSeeded(gid);

      await prisma.communityPoster.upsert({
        where: { guildId_slot: { guildId: gid, slot: options.slot } },
        create: {
          guildId: gid,
          slot: options.slot,
          slug,
          title,
          enabled: true,
          updatedBy: options.updatedBy,
        },
        update: {
          slug,
          title,
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
        jpegSlot: options.slot,
        jpegBytes: jpeg,
        commitMessage:
          options.commitMessage ??
          `chore(posters): set slot ${options.slot} (${slug}) v${state.version}`,
      });

      const urls = await this.getPublicUrls(gid);
      loggers.bot.info(
        `Poster slot ${options.slot} published for guild ${gid} (v${state.version}, commit ${publish.commitSha})`,
      );

      return {
        manifest,
        imageUrl: urls.imageUrl(options.slot),
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
        options.title !== undefined ? options.title.trim() : existing.title;
      if (options.title !== undefined && !title) {
        throw new PosterValidationError("Title cannot be empty.");
      }

      const slug =
        options.id !== undefined && options.id !== null
          ? slugifyPosterId(options.id.trim() || title)
          : options.title !== undefined
            ? slugifyPosterId(title)
            : existing.slug;

      const data: {
        enabled?: boolean;
        title?: string;
        slug?: string;
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

      const publish = await this.githubPublisher.updateRepositoryWithPosterFiles({
        guildId: gid,
        posterJson,
        commitMessage:
          options.commitMessage ??
          `chore(posters): update slot ${options.slot} metadata v${state.version}`,
      });

      const urls = await this.getPublicUrls(gid);
      return {
        manifest,
        imageUrl: urls.imageUrl(options.slot),
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

      const publish = await this.githubPublisher.updateRepositoryWithPosterFiles({
        guildId: gid,
        posterJson,
        commitMessage:
          commitMessage ??
          `chore(posters): force update poster.json v${manifest.version}`,
      });

      const urls = await this.getPublicUrls(gid);
      return {
        manifest,
        commitSha: publish.commitSha,
        jsonUrl: urls.jsonUrl,
      };
    });
  }
}

export const posterManager = new PosterManager();
