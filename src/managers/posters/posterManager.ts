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

export class PosterManager {
  private githubPublisher = new GitHubPublisher();

  async ensureSeeded(): Promise<void> {
    await prisma.communityPosterState.upsert({
      where: { id: 1 },
      create: { id: 1, version: 0 },
      update: {},
    });

    for (let slot = 0; slot < POSTERS_MAX_SLOTS; slot++) {
      await prisma.communityPoster.upsert({
        where: { slot },
        create: {
          slot,
          slug: `slot-${slot}`,
          title: `Slot ${slot}`,
          enabled: false,
        },
        update: {},
      });
    }
  }

  async getManifest(): Promise<PosterManifest> {
    await this.ensureSeeded();
    const [state, posters] = await Promise.all([
      prisma.communityPosterState.findUniqueOrThrow({ where: { id: 1 } }),
      prisma.communityPoster.findMany({ orderBy: { slot: "asc" } }),
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

  async getManifestJson(): Promise<string> {
    return `${JSON.stringify(await this.getManifest(), null, 2)}\n`;
  }

  async getPublicUrls(guildId?: string): Promise<{
    owner: string;
    repo: string;
    jsonUrl: string;
    imageUrl: (slot: number) => string;
  }> {
    const { owner, repo } =
      await this.githubPublisher.getPosterRepoSettings(guildId);
    return {
      owner,
      repo,
      jsonUrl: posterJsonPublicUrl(owner, repo),
      imageUrl: (slot: number) => posterImagePublicUrl(owner, repo, slot),
    };
  }

  async listForStaff(guildId?: string): Promise<{
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
    const manifest = await this.getManifest();
    const urls = await this.getPublicUrls(guildId);
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
    guildId?: string;
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
    this.assertSlot(options.slot);
    const title = options.title.trim();
    if (!title) {
      throw new PosterValidationError("Title cannot be empty.");
    }

    const slug = slugifyPosterId(options.id?.trim() || title);
    const jpeg = await createFramedPosterJpeg(options.image, options.mimeType);

    return withPublishLock(async () => {
      await this.ensureSeeded();

      await prisma.communityPoster.upsert({
        where: { slot: options.slot },
        create: {
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
        where: { id: 1 },
        data: { version: { increment: 1 } },
      });

      const manifest = await this.getManifest();
      const posterJson = `${JSON.stringify(manifest, null, 2)}\n`;

      const publish = await this.githubPublisher.updateRepositoryWithPosterFiles({
        guildId: options.guildId,
        posterJson,
        jpegSlot: options.slot,
        jpegBytes: jpeg,
        commitMessage:
          options.commitMessage ??
          `chore(posters): set slot ${options.slot} (${slug}) v${state.version}`,
      });

      const urls = await this.getPublicUrls(options.guildId);
      loggers.bot.info(
        `Poster slot ${options.slot} published (v${state.version}, commit ${publish.commitSha})`,
      );

      return {
        manifest,
        imageUrl: urls.imageUrl(options.slot),
        commitSha: publish.commitSha,
      };
    });
  }

  async updatePosterMeta(options: {
    guildId?: string;
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
    this.assertSlot(options.slot);

    return withPublishLock(async () => {
      await this.ensureSeeded();

      const existing = await prisma.communityPoster.findUnique({
        where: { slot: options.slot },
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
        where: { slot: options.slot },
        data,
      });

      const state = await prisma.communityPosterState.update({
        where: { id: 1 },
        data: { version: { increment: 1 } },
      });

      const manifest = await this.getManifest();
      const posterJson = `${JSON.stringify(manifest, null, 2)}\n`;

      const publish = await this.githubPublisher.updateRepositoryWithPosterFiles({
        guildId: options.guildId,
        posterJson,
        commitMessage:
          options.commitMessage ??
          `chore(posters): update slot ${options.slot} metadata v${state.version}`,
      });

      const urls = await this.getPublicUrls(options.guildId);
      return {
        manifest,
        imageUrl: urls.imageUrl(options.slot),
        commitSha: publish.commitSha,
      };
    });
  }

  async forceUpdate(guildId?: string, commitMessage?: string): Promise<{
    manifest: PosterManifest;
    commitSha?: string;
    jsonUrl: string;
  }> {
    return withPublishLock(async () => {
      await this.ensureSeeded();
      const manifest = await this.getManifest();
      const posterJson = `${JSON.stringify(manifest, null, 2)}\n`;

      const publish = await this.githubPublisher.updateRepositoryWithPosterFiles({
        guildId,
        posterJson,
        commitMessage:
          commitMessage ??
          `chore(posters): force update poster.json v${manifest.version}`,
      });

      const urls = await this.getPublicUrls(guildId);
      return {
        manifest,
        commitSha: publish.commitSha,
        jsonUrl: urls.jsonUrl,
      };
    });
  }
}

export const posterManager = new PosterManager();
