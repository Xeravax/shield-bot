import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
} from "discord.js";
import type { ModCase, ModCaseType, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../main.js";
import { loggers } from "../../utility/logger.js";
import type { AuditLogManager } from "./auditLogManager.js";
import { claimButtonCustomId } from "./loggingTypes.js";

export type CreateModCaseInput = {
  guildId: string;
  type: ModCaseType;
  targetId: string;
  moderatorId: string;
  reason?: string | null;
  expiresAt?: Date | null;
  active?: boolean;
  metadata?: Prisma.InputJsonValue;
  claimable?: boolean;
  extraFields?: { name: string; value: string; inline?: boolean }[];
};

const CASE_COLORS: Partial<Record<ModCaseType, number>> = {
  WARN: 0xfaa61a,
  KICK: 0xe67e22,
  BAN: 0xed4245,
  UNBAN: 0x57f287,
  TIMEOUT: 0xfaa61a,
  UNTIMEOUT: 0x57f287,
  SOFTBAN: 0xed4245,
  PURGE: 0x5865f2,
  FILTER: 0xfaa61a,
  LOCK: 0xe67e22,
  UNLOCK: 0x57f287,
  NOTE: 0x5865f2,
};

const MAX_EMBED_FIELDS = 25;
const GATEWAY_SUPPRESS_TTL_MS = 15_000;
const UNKNOWN_BAN_CODE = 10026;

export class ModCaseManager {
  private readonly gatewaySuppress = new Map<string, number>();

  constructor(
    private readonly client: Client,
    private readonly auditLog: AuditLogManager,
  ) {}

  private suppressKey(guildId: string, type: ModCaseType, targetId: string): string {
    return `${guildId}:${type}:${targetId}`;
  }

  private pruneGatewaySuppress(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.gatewaySuppress) {
      if (expiresAt <= now) {
        this.gatewaySuppress.delete(key);
      }
    }
  }

  /** Short-lived dedup so guildBanAdd/Remove gateways skip command-initiated cases. */
  suppressGatewayCase(
    guildId: string,
    targetId: string,
    types: ModCaseType[],
  ): void {
    this.pruneGatewaySuppress();
    const until = Date.now() + GATEWAY_SUPPRESS_TTL_MS;
    for (const type of types) {
      this.gatewaySuppress.set(this.suppressKey(guildId, type, targetId), until);
    }
  }

  shouldSuppressGatewayCase(
    guildId: string,
    type: ModCaseType,
    targetId: string,
  ): boolean {
    this.pruneGatewaySuppress();
    const until = this.gatewaySuppress.get(this.suppressKey(guildId, type, targetId));
    return typeof until === "number" && until > Date.now();
  }

  private async maxCaseNumber(guildId: string): Promise<number> {
    const last = await prisma.modCase.findFirst({
      where: { guildId },
      orderBy: { caseNumber: "desc" },
      select: { caseNumber: true },
    });
    return last?.caseNumber ?? 0;
  }

  /** Atomically allocate the next per-guild case number via GuildSettings.modCaseCounter. */
  private async allocateCaseNumber(guildId: string): Promise<number> {
    const existing = await prisma.guildSettings.findUnique({
      where: { guildId },
      select: { guildId: true },
    });
    if (!existing) {
      const seed = await this.maxCaseNumber(guildId);
      try {
        await prisma.guildSettings.create({
          data: { guildId, modCaseCounter: seed },
        });
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code)
            : null;
        if (code !== "P2002") {
          throw error;
        }
        // Concurrent create — fall through to increment.
      }
    }

    const updated = await prisma.guildSettings.update({
      where: { guildId },
      data: { modCaseCounter: { increment: 1 } },
      select: { modCaseCounter: true },
    });
    return updated.modCaseCounter;
  }

  buildCaseEmbed(modCase: ModCase, options?: {
    claimedByTag?: string | null;
  }): EmbedBuilder {
    const fields: { name: string; value: string; inline?: boolean }[] = [
      {
        name: "Target",
        value: `<@${modCase.targetId}> (\`${modCase.targetId}\`)`,
        inline: true,
      },
      {
        name: "Moderator",
        value: `<@${modCase.moderatorId}> (\`${modCase.moderatorId}\`)`,
        inline: true,
      },
      {
        name: "Reason",
        value: modCase.reason?.slice(0, 1024) || "*No reason provided*",
      },
    ];

    if (modCase.expiresAt) {
      fields.push({
        name: "Expires",
        value: `<t:${Math.floor(modCase.expiresAt.getTime() / 1000)}:F>`,
        inline: true,
      });
    }

    if (modCase.claimedBy) {
      fields.push({
        name: "Claimed by",
        value: options?.claimedByTag
          ? `${options.claimedByTag} (\`${modCase.claimedBy}\`)`
          : `<@${modCase.claimedBy}> (\`${modCase.claimedBy}\`)`,
        inline: true,
      });
      if (modCase.claimedReason) {
        fields.push({
          name: "Claim reason",
          value: modCase.claimedReason.slice(0, 1024),
        });
      }
      if (modCase.claimedAt) {
        fields.push({
          name: "Claimed at",
          value: `<t:${Math.floor(modCase.claimedAt.getTime() / 1000)}:F>`,
          inline: true,
        });
      }
    }

    return new EmbedBuilder()
      .setColor(CASE_COLORS[modCase.type] ?? 0xeb459e)
      .setTitle(`${modCase.type} · Case #${modCase.caseNumber}`)
      .setTimestamp(modCase.createdAt)
      .addFields(fields.slice(0, MAX_EMBED_FIELDS))
      .setFooter({ text: `Case ID ${modCase.id}` });
  }

  private claimRow(caseId: number) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(claimButtonCustomId(caseId))
        .setLabel("Claim")
        .setStyle(ButtonStyle.Primary),
    );
  }

  private async syncCaseLogMessage(
    modCase: ModCase,
    options?: { clearComponents?: boolean },
  ): Promise<void> {
    if (!modCase.logMessageId || !modCase.logThreadId) {
      return;
    }
    try {
      const guild = await this.client.guilds.fetch(modCase.guildId);
      const channel = await guild.channels.fetch(modCase.logThreadId);
      if (channel?.isTextBased()) {
        const msg = await channel.messages.fetch(modCase.logMessageId);
        const claimable =
          !options?.clearComponents &&
          !modCase.claimedBy &&
          modCase.type !== "NOTE";
        await msg.edit({
          embeds: [this.buildCaseEmbed(modCase)],
          components: claimable ? [this.claimRow(modCase.id)] : [],
        });
      }
    } catch (error) {
      loggers.bot.warn("Failed to update case log message", error);
    }
  }

  async createCase(input: CreateModCaseInput): Promise<ModCase> {
    const claimable = input.claimable !== false && input.type !== "NOTE";

    const caseNumber = await this.allocateCaseNumber(input.guildId);
    let modCase = await prisma.modCase.create({
      data: {
        guildId: input.guildId,
        caseNumber,
        type: input.type,
        targetId: input.targetId,
        moderatorId: input.moderatorId,
        reason: input.reason ?? null,
        expiresAt: input.expiresAt ?? null,
        active: input.active ?? true,
        metadata: input.metadata ?? undefined,
      },
    });

    this.suppressGatewayCase(input.guildId, input.targetId, [input.type]);

    try {
      const embed = this.buildCaseEmbed(modCase);
      const usedFields = embed.data.fields?.length ?? 0;
      if (input.extraFields?.length) {
        const room = Math.max(0, MAX_EMBED_FIELDS - usedFields);
        if (room > 0) {
          embed.addFields(
            input.extraFields.slice(0, room).map((f) => ({
              name: f.name.slice(0, 256),
              value: f.value.slice(0, 1024) || "—",
              inline: f.inline,
            })),
          );
        }
      }

      const guild = await this.client.guilds.fetch(input.guildId).catch(() => null);
      const thread = guild
        ? await this.auditLog.resolveCategoryThread(guild, "moderation")
        : null;

      if (thread) {
        const message = await thread.send({
          embeds: [embed],
          components: claimable ? [this.claimRow(modCase.id)] : [],
        });
        modCase = await prisma.modCase.update({
          where: { id: modCase.id },
          data: {
            logMessageId: message.id,
            logThreadId: message.channelId,
          },
        });
      }
    } catch (error) {
      loggers.bot.warn("Failed to post mod case log", error);
    }

    return modCase;
  }

  async findActiveCase(
    guildId: string,
    targetId: string,
    type: ModCaseType,
  ): Promise<ModCase | null> {
    return prisma.modCase.findFirst({
      where: { guildId, targetId, type, active: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async deactivateActiveCases(
    guildId: string,
    targetId: string,
    type: ModCaseType,
  ): Promise<number> {
    const result = await prisma.modCase.updateMany({
      where: { guildId, targetId, type, active: true },
      data: { active: false },
    });
    return result.count;
  }

  async claimCase(
    caseId: number,
    claimedBy: string,
    claimedReason: string,
  ): Promise<{ success: boolean; error?: string; modCase?: ModCase }> {
    const existing = await prisma.modCase.findUnique({ where: { id: caseId } });
    if (!existing) {
      return { success: false, error: "Case not found." };
    }
    if (existing.claimedBy) {
      return { success: false, error: "This case is already claimed." };
    }

    const updated = await prisma.modCase.updateMany({
      where: { id: caseId, claimedBy: null },
      data: {
        claimedBy,
        claimedReason,
        claimedAt: new Date(),
        reason: existing.reason?.trim()
          ? existing.reason
          : claimedReason,
      },
    });

    if (updated.count === 0) {
      return { success: false, error: "This case is already claimed." };
    }

    const modCase = await prisma.modCase.findUniqueOrThrow({ where: { id: caseId } });
    await this.syncCaseLogMessage(modCase, { clearComponents: true });

    return { success: true, modCase };
  }

  async updateReason(
    guildId: string,
    caseNumber: number,
    reason: string,
  ): Promise<{ success: boolean; error?: string; modCase?: ModCase }> {
    const existing = await prisma.modCase.findUnique({
      where: { guildId_caseNumber: { guildId, caseNumber } },
    });
    if (!existing) {
      return { success: false, error: "Case not found." };
    }

    const modCase = await prisma.modCase.update({
      where: { id: existing.id },
      data: { reason },
    });

    await this.syncCaseLogMessage(modCase);

    return { success: true, modCase };
  }

  async getCasesForUser(guildId: string, targetId: string, take = 10) {
    return prisma.modCase.findMany({
      where: { guildId, targetId },
      orderBy: { caseNumber: "desc" },
      take,
    });
  }

  async getCaseByNumber(guildId: string, caseNumber: number) {
    return prisma.modCase.findUnique({
      where: { guildId_caseNumber: { guildId, caseNumber } },
    });
  }

  async addNote(guildId: string, targetId: string, authorId: string, content: string) {
    const note = await prisma.modUserNote.create({
      data: { guildId, targetId, authorId, content },
    });
    await this.createCase({
      guildId,
      type: "NOTE",
      targetId,
      moderatorId: authorId,
      reason: content,
      claimable: false,
      active: false,
    });
    return note;
  }

  async listNotes(guildId: string, targetId: string, take = 20) {
    return prisma.modUserNote.findMany({
      where: { guildId, targetId },
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  async expireTempBans(): Promise<number> {
    const now = new Date();
    const due = await prisma.modCase.findMany({
      where: {
        type: "BAN",
        active: true,
        expiresAt: { lte: now },
      },
      take: 50,
    });

    let processed = 0;
    for (const modCase of due) {
      try {
        const guild = await this.client.guilds.fetch(modCase.guildId).catch(() => null);
        if (!guild) {
          continue;
        }

        let unbanOk = false;
        try {
          await guild.members.unban(
            modCase.targetId,
            `Temp ban expired (case #${modCase.caseNumber})`,
          );
          unbanOk = true;
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error
              ? Number((error as { code: unknown }).code)
              : null;
          if (code === UNKNOWN_BAN_CODE) {
            unbanOk = true;
          } else {
            loggers.bot.warn(
              `Failed to unban for temp ban case ${modCase.id}`,
              error,
            );
            continue;
          }
        }

        if (!unbanOk) {
          continue;
        }

        await prisma.modCase.update({
          where: { id: modCase.id },
          data: { active: false },
        });

        this.suppressGatewayCase(modCase.guildId, modCase.targetId, ["UNBAN"]);
        await this.createCase({
          guildId: modCase.guildId,
          type: "UNBAN",
          targetId: modCase.targetId,
          moderatorId: this.client.user?.id ?? modCase.moderatorId,
          reason: `Automatic unban — temp ban case #${modCase.caseNumber} expired`,
          claimable: false,
          active: false,
        });
        processed++;
      } catch (error) {
        loggers.bot.warn(`Failed to expire temp ban case ${modCase.id}`, error);
      }
    }
    return processed;
  }
}
