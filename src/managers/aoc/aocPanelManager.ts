import {
  Client,
  Colors,
  ContainerBuilder,
  Guild,
  GuildMember,
  MessageFlags,
  TextDisplayBuilder,
  VoiceChannel,
  type SendableChannels,
} from "discord.js";
import { prisma } from "../../main.js";
import { loggers } from "../../utility/logger.js";

type EnrolledUser = {
  discordId: string;
  reason: string;
};

/**
 * Resolve the AoC voice channel and its in-voice text chat (discord.js TextBasedChannel on GuildVoiceChannel).
 */
async function resolveAoCVoiceChannel(
  guild: Guild,
  aocVoiceChannelId: string,
): Promise<VoiceChannel | null> {
  const channel = await guild.channels.fetch(aocVoiceChannelId).catch(() => null);
  if (!channel?.isVoiceBased()) {
    return null;
  }
  return channel as VoiceChannel;
}

function formatUserList(users: EnrolledUser[], emptyMessage: string): string {
  if (users.length === 0) {
    return emptyMessage;
  }
  return users.map((u) => `<@${u.discordId}>`).join("\n");
}

function formatOnPatrolSection(users: EnrolledUser[], emptyMessage: string): string {
  if (users.length === 0) {
    return emptyMessage;
  }
  const lines: string[] = [];
  for (const u of users) {
    lines.push(`<@${u.discordId}>`, u.reason, "");
  }
  return lines.join("\n").trimEnd();
}

export class AoCPanelManager {
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  private repostTimers = new Map<string, NodeJS.Timeout>();
  private refreshInFlight = new Map<string, Promise<void>>();

  constructor(private client: Client) {}

  /** Debounced refresh when voice/patrol state changes rapidly. */
  scheduleRefresh(guildId: string, delayMs = 500): void {
    const existing = this.refreshTimers.get(guildId);
    if (existing) {
      clearTimeout(existing);
    }
    this.refreshTimers.set(
      guildId,
      setTimeout(() => {
        this.refreshTimers.delete(guildId);
        void this.refreshPanel(guildId).catch((err) =>
          loggers.bot.error("AoC panel refresh failed", err),
        );
      }, delayMs),
    );
  }

  async onAoCVoiceJoin(guildId: string): Promise<void> {
    this.scheduleRefresh(guildId);
  }

  /**
   * When someone posts in the AoC voice text chat while patrol is active and the panel
   * is present, delete the old panel and post a fresh one at the bottom.
   */
  async onMessageInAoCVoiceChat(
    guildId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId },
      select: { aocVoiceChannelId: true, aocPanelMessageId: true },
    });
    if (!settings?.aocVoiceChannelId || settings.aocVoiceChannelId !== channelId) {
      return;
    }
    if (!settings.aocPanelMessageId || settings.aocPanelMessageId === messageId) {
      return;
    }

    this.scheduleRepost(guildId);
  }

  /** Debounced repost so rapid chat does not spam delete/send cycles. */
  private scheduleRepost(guildId: string, delayMs = 500): void {
    const existing = this.repostTimers.get(guildId);
    if (existing) {
      clearTimeout(existing);
    }
    this.repostTimers.set(
      guildId,
      setTimeout(() => {
        this.repostTimers.delete(guildId);
        void this.repostPanel(guildId).catch((err) =>
          loggers.bot.error("AoC panel repost failed", err),
        );
      }, delayMs),
    );
  }

  private async hasActivePatrol(guildId: string): Promise<boolean> {
    const activeSessions = await prisma.activeVoicePatrolSession.count({
      where: { guildId },
    });
    return activeSessions > 0;
  }

  private async getPanelTarget(
    guildId: string,
  ): Promise<{ guild: Guild; voiceChannel: VoiceChannel } | null> {
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId },
      select: { aocVoiceChannelId: true },
    });
    if (!settings?.aocVoiceChannelId) {
      return null;
    }

    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      return null;
    }

    const voiceChannel = await resolveAoCVoiceChannel(guild, settings.aocVoiceChannelId);
    if (!voiceChannel) {
      loggers.bot.warn(`AoC voice channel ${settings.aocVoiceChannelId} not found in guild ${guildId}`);
      return null;
    }

    return { guild, voiceChannel };
  }

  async refreshPanel(guildId: string): Promise<void> {
    return this.runPanelUpdate(guildId, "refresh");
  }

  private async repostPanel(guildId: string): Promise<void> {
    return this.runPanelUpdate(guildId, "repost");
  }

  private async runPanelUpdate(
    guildId: string,
    mode: "refresh" | "repost",
  ): Promise<void> {
    const inFlight = this.refreshInFlight.get(guildId);
    if (inFlight) {
      return inFlight;
    }

    const run = (mode === "repost" ? this.runRepostPanel(guildId) : this.runRefreshPanel(guildId)).finally(
      () => {
        this.refreshInFlight.delete(guildId);
      },
    );
    this.refreshInFlight.set(guildId, run);
    return run;
  }

  private async runRepostPanel(guildId: string): Promise<void> {
    const target = await this.getPanelTarget(guildId);
    if (!target) {
      return;
    }

    const { guild, voiceChannel } = target;
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId },
      select: { aocPanelMessageId: true },
    });

    if (!settings?.aocPanelMessageId) {
      return;
    }

    const someoneInAoC = voiceChannel.members.filter((m: GuildMember) => !m.user.bot).size > 0;
    if (!someoneInAoC) {
      return;
    }

    if (!(await this.hasActivePatrol(guildId))) {
      return;
    }

    const existing = await voiceChannel.messages.fetch(settings.aocPanelMessageId).catch(() => null);
    if (!existing) {
      return;
    }

    await existing.delete().catch(() => null);

    const components = await this.buildPanelComponents(guildId, guild);
    const sent = await (voiceChannel as SendableChannels).send({
      components,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [] },
    });

    await prisma.guildSettings.update({
      where: { guildId },
      data: { aocPanelMessageId: sent.id },
    });
  }

  private async runRefreshPanel(guildId: string): Promise<void> {
    const target = await this.getPanelTarget(guildId);
    if (!target) {
      return;
    }

    const { guild, voiceChannel } = target;
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId },
      select: {
        aocPanelMessageId: true,
        patrolChannelCategoryId: true,
      },
    });

    const someoneInAoC = voiceChannel.members.filter((m: GuildMember) => !m.user.bot).size > 0;

    if (!someoneInAoC) {
      if (settings?.aocPanelMessageId) {
        const old = await voiceChannel.messages.fetch(settings.aocPanelMessageId).catch(() => null);
        if (old) {
          await old.delete().catch(() => null);
        }
        await prisma.guildSettings.update({
          where: { guildId },
          data: { aocPanelMessageId: null },
        });
      }
      return;
    }

    const components = await this.buildPanelComponents(guildId, guild);

    if (settings?.aocPanelMessageId) {
      const existing = await voiceChannel.messages.fetch(settings.aocPanelMessageId).catch(() => null);
      if (existing) {
        try {
          await existing.edit({
            components,
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { users: [] },
          });
          return;
        } catch {
          await existing.delete().catch(() => null);
        }
      }
    }

    const sent = await (voiceChannel as SendableChannels).send({
      components,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [] },
    });

    await prisma.guildSettings.update({
      where: { guildId },
      data: { aocPanelMessageId: sent.id },
    });
  }

  private async getEnrolledUsersInGuild(guild: Guild): Promise<EnrolledUser[]> {
    const accounts = await prisma.vRChatAccount.findMany({
      where: {
        accountType: "MAIN",
        phantomCompilerReason: { not: null },
      },
      include: { user: { select: { discordId: true } } },
    });

    const enrolled: EnrolledUser[] = [];
    for (const a of accounts) {
      if (!a.phantomCompilerReason) {
        continue;
      }
      const member = guild.members.cache.get(a.user.discordId)
        ?? await guild.members.fetch(a.user.discordId).catch(() => null);
      if (member && !member.user.bot) {
        enrolled.push({ discordId: a.user.discordId, reason: a.phantomCompilerReason });
      }
    }
    return enrolled;
  }

  private async getPatrollingEnrolledUserIds(
    guild: Guild,
    patrolCategoryId: string | null,
    enrolled: EnrolledUser[],
  ): Promise<Set<string>> {
    const patrolling = new Set<string>();
    if (!patrolCategoryId || enrolled.length === 0) {
      return patrolling;
    }

    const enrolledIds = new Set(enrolled.map((e) => e.discordId));

    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased()) {
        continue;
      }
      if (channel.parentId !== patrolCategoryId) {
        continue;
      }
      for (const member of channel.members.values()) {
        if (!member.user.bot && enrolledIds.has(member.id)) {
          patrolling.add(member.id);
        }
      }
    }

    return patrolling;
  }

  private async buildPanelComponents(guildId: string, guild: Guild): Promise<ContainerBuilder[]> {
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId },
      select: { patrolChannelCategoryId: true },
    });

    const enrolled = await this.getEnrolledUsersInGuild(guild);
    const patrollingIds = await this.getPatrollingEnrolledUserIds(
      guild,
      settings?.patrolChannelCategoryId ?? null,
      enrolled,
    );

    const onPatrolUsers = enrolled.filter((e) => patrollingIds.has(e.discordId));
    const notOnPatrolUsers = enrolled.filter((e) => !patrollingIds.has(e.discordId));

    const headerContainer = new ContainerBuilder()
      .setAccentColor(Colors.Blurple)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            "**AoC — Phantom Compiler Panel**",
            "",
            "_Live view of phantom-compiler enrollments. Updates when patrol or AoC voice state changes._",
          ].join("\n"),
        ),
      );

    const onPatrolContainer = new ContainerBuilder()
      .setAccentColor(Colors.Green)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            "**On patrol (phantom compiler)**",
            "",
            formatOnPatrolSection(
              onPatrolUsers,
              "_No enrolled members currently in a patrol channel._",
            ),
          ].join("\n"),
        ),
      );

    const enrolledContainer = new ContainerBuilder()
      .setAccentColor(Colors.Gold)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            "**Enrolled (phantom compiler)**",
            "",
            formatUserList(
              notOnPatrolUsers,
              "_All enrolled members are currently on patrol, or nobody is enrolled._",
            ),
          ].join("\n"),
        ),
      );

    return [headerContainer, onPatrolContainer, enrolledContainer];
  }
}
