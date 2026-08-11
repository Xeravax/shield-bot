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

export class ModCaseManager {
  constructor(
    private readonly client: Client,
    private readonly auditLog: AuditLogManager,
  ) {}

  private async nextCaseNumber(guildId: string): Promise<number> {
    const last = await prisma.modCase.findFirst({
      where: { guildId },
      orderBy: { caseNumber: "desc" },
      select: { caseNumber: true },
    });
    return (last?.caseNumber ?? 0) + 1;
  }

  buildCaseEmbed(modCase: ModCase, options?: {
    claimedByTag?: string | null;
  }): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(CASE_COLORS[modCase.type] ?? 0xeb459e)
      .setTitle(`${modCase.type} · Case #${modCase.caseNumber}`)
      .setTimestamp(modCase.createdAt)
      .addFields(
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
      )
      .setFooter({ text: `Case ID ${modCase.id}` });

    if (modCase.expiresAt) {
      embed.addFields({
        name: "Expires",
        value: `<t:${Math.floor(modCase.expiresAt.getTime() / 1000)}:F>`,
        inline: true,
      });
    }

    if (modCase.claimedBy) {
      embed.addFields({
        name: "Claimed by",
        value: options?.claimedByTag
          ? `${options.claimedByTag} (\`${modCase.claimedBy}\`)`
          : `<@${modCase.claimedBy}> (\`${modCase.claimedBy}\`)`,
        inline: true,
      });
      if (modCase.claimedReason) {
        embed.addFields({
          name: "Claim reason",
          value: modCase.claimedReason.slice(0, 1024),
        });
      }
      if (modCase.claimedAt) {
        embed.addFields({
          name: "Claimed at",
          value: `<t:${Math.floor(modCase.claimedAt.getTime() / 1000)}:F>`,
          inline: true,
        });
      }
    }

    return embed;
  }

  private claimRow(caseId: number) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(claimButtonCustomId(caseId))
        .setLabel("Claim")
        .setStyle(ButtonStyle.Primary),
    );
  }

  async createCase(input: CreateModCaseInput): Promise<ModCase> {
    const caseNumber = await this.nextCaseNumber(input.guildId);
    const claimable = input.claimable !== false && input.type !== "NOTE";

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

    try {
      const embed = this.buildCaseEmbed(modCase);
      if (input.extraFields?.length) {
        embed.addFields(input.extraFields);
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

    const modCase = await prisma.modCase.update({
      where: { id: caseId },
      data: {
        claimedBy,
        claimedReason,
        claimedAt: new Date(),
        reason: existing.reason?.trim()
          ? existing.reason
          : claimedReason,
      },
    });

    if (modCase.logMessageId && modCase.logThreadId) {
      try {
        const guild = await this.client.guilds.fetch(modCase.guildId);
        const channel = await guild.channels.fetch(modCase.logThreadId);
        if (channel?.isTextBased()) {
          const msg = await channel.messages.fetch(modCase.logMessageId);
          await msg.edit({
            embeds: [this.buildCaseEmbed(modCase)],
            components: [],
          });
        }
      } catch (error) {
        loggers.bot.warn("Failed to update claimed case message", error);
      }
    }

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

    if (modCase.logMessageId && modCase.logThreadId) {
      try {
        const guild = await this.client.guilds.fetch(modCase.guildId);
        const channel = await guild.channels.fetch(modCase.logThreadId);
        if (channel?.isTextBased()) {
          const msg = await channel.messages.fetch(modCase.logMessageId);
          const claimable = !modCase.claimedBy && modCase.type !== "NOTE";
          await msg.edit({
            embeds: [this.buildCaseEmbed(modCase)],
            components: claimable ? [this.claimRow(modCase.id)] : [],
          });
        }
      } catch (error) {
        loggers.bot.warn("Failed to update case reason message", error);
      }
    }

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
        await guild.members.unban(
          modCase.targetId,
          `Temp ban expired (case #${modCase.caseNumber})`,
        ).catch(() => undefined);

        await prisma.modCase.update({
          where: { id: modCase.id },
          data: { active: false },
        });

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
