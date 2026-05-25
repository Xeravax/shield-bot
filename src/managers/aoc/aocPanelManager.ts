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

type EnrolledUserOnPatrol = EnrolledUser & {
  patrolChannelId: string;
};

type PhantomPanelSite = {
  key: "aoc" | "emt";
  voiceChannelIdField: "aocVoiceChannelId" | "emtVoiceChannelId";
  panelMessageIdField: "aocPanelMessageId" | "emtPanelMessageId";
  headerTitle: string;
};

const PHANTOM_PANEL_SITES: PhantomPanelSite[] = [
  {
    key: "aoc",
    voiceChannelIdField: "aocVoiceChannelId",
    panelMessageIdField: "aocPanelMessageId",
    headerTitle: "**AoC — Phantom Compiler Panel**",
  },
  {
    key: "emt",
    voiceChannelIdField: "emtVoiceChannelId",
    panelMessageIdField: "emtPanelMessageId",
    headerTitle: "**EMT — Phantom Compiler Panel**",
  },
];

type GuildPanelSettings = {
  patrolChannelCategoryId: string | null;
  aocVoiceChannelId: string | null;
  aocPanelMessageId: string | null;
  emtVoiceChannelId: string | null;
  emtPanelMessageId: string | null;
};

async function resolveVoiceChannel(
  guild: Guild,
  voiceChannelId: string,
): Promise<VoiceChannel | null> {
  const channel = await guild.channels.fetch(voiceChannelId).catch(() => null);
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

function formatOnPatrolSection(users: EnrolledUserOnPatrol[], emptyMessage: string): string {
  if (users.length === 0) {
    return emptyMessage;
  }
  const lines: string[] = [];
  for (const u of users) {
    lines.push(`<@${u.discordId}> — <#${u.patrolChannelId}>`, u.reason, "");
  }
  return lines.join("\n").trimEnd();
}

export class AoCPanelManager {
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  private repostTimers = new Map<string, NodeJS.Timeout>(); // key: `${guildId}:${siteKey}`
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
          loggers.bot.error("Phantom panel refresh failed", err),
        );
      }, delayMs),
    );
  }

  async onPhantomPanelVoiceJoin(guildId: string): Promise<void> {
    this.scheduleRefresh(guildId);
  }

  /**
   * When someone posts in a configured phantom-panel voice text chat while patrol is active,
   * delete the old panel and post a fresh one at the bottom.
   */
  async onMessageInPhantomPanelVoiceChat(
    guildId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    const settings = await this.getGuildPanelSettings(guildId);
    if (!settings) {
      return;
    }

    for (const site of this.getActiveSites(settings)) {
      const voiceChannelId = settings[site.voiceChannelIdField];
      if (voiceChannelId !== channelId) {
        continue;
      }
      const panelMessageId = settings[site.panelMessageIdField];
      if (panelMessageId && panelMessageId === messageId) {
        return;
      }
      this.scheduleRepost(guildId, site.key);
      return;
    }
  }

  /** @deprecated Use onMessageInPhantomPanelVoiceChat */
  async onMessageInAoCVoiceChat(
    guildId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    return this.onMessageInPhantomPanelVoiceChat(guildId, channelId, messageId);
  }

  /** @deprecated Use onPhantomPanelVoiceJoin */
  async onAoCVoiceJoin(guildId: string): Promise<void> {
    return this.onPhantomPanelVoiceJoin(guildId);
  }

  private scheduleRepost(guildId: string, siteKey: PhantomPanelSite["key"], delayMs = 500): void {
    const timerKey = `${guildId}:${siteKey}`;
    const existing = this.repostTimers.get(timerKey);
    if (existing) {
      clearTimeout(existing);
    }
    this.repostTimers.set(
      timerKey,
      setTimeout(() => {
        this.repostTimers.delete(timerKey);
        void this.repostPanelForSite(guildId, siteKey).catch((err) =>
          loggers.bot.error("Phantom panel repost failed", err),
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

  private async getGuildPanelSettings(guildId: string): Promise<GuildPanelSettings | null> {
    return prisma.guildSettings.findUnique({
      where: { guildId },
      select: {
        patrolChannelCategoryId: true,
        aocVoiceChannelId: true,
        aocPanelMessageId: true,
        emtVoiceChannelId: true,
        emtPanelMessageId: true,
      },
    });
  }

  private getActiveSites(settings: GuildPanelSettings): PhantomPanelSite[] {
    return PHANTOM_PANEL_SITES.filter((site) => {
      const voiceId = settings[site.voiceChannelIdField];
      return !!voiceId;
    });
  }

  private async getPanelTarget(
    guildId: string,
    site: PhantomPanelSite,
    settings: GuildPanelSettings,
  ): Promise<{ guild: Guild; voiceChannel: VoiceChannel } | null> {
    const voiceChannelId = settings[site.voiceChannelIdField];
    if (!voiceChannelId) {
      return null;
    }

    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      return null;
    }

    const voiceChannel = await resolveVoiceChannel(guild, voiceChannelId);
    if (!voiceChannel) {
      loggers.bot.warn(
        `${site.key} voice channel ${voiceChannelId} not found in guild ${guildId}`,
      );
      return null;
    }

    return { guild, voiceChannel };
  }

  async refreshPanel(guildId: string): Promise<void> {
    return this.runPanelUpdate(guildId);
  }

  private async repostPanelForSite(guildId: string, siteKey: PhantomPanelSite["key"]): Promise<void> {
    const settings = await this.getGuildPanelSettings(guildId);
    if (!settings || !(await this.hasActivePatrol(guildId))) {
      return;
    }
    const site = PHANTOM_PANEL_SITES.find((s) => s.key === siteKey);
    if (!site || !settings[site.voiceChannelIdField]) {
      return;
    }
    await this.runRepostPanelForSite(guildId, site, settings);
  }

  private async runPanelUpdate(guildId: string): Promise<void> {
    const inFlight = this.refreshInFlight.get(guildId);
    if (inFlight) {
      return inFlight;
    }

    const run = this.runRefreshAllPanels(guildId).finally(() => {
      this.refreshInFlight.delete(guildId);
    });
    this.refreshInFlight.set(guildId, run);
    return run;
  }

  private async runRepostPanelForSite(
    guildId: string,
    site: PhantomPanelSite,
    settings: GuildPanelSettings,
  ): Promise<void> {
    const target = await this.getPanelTarget(guildId, site, settings);
    if (!target) {
      return;
    }

    const { voiceChannel } = target;
    const panelMessageId = settings[site.panelMessageIdField];
    if (!panelMessageId) {
      return;
    }

    const someoneInChannel = voiceChannel.members.filter((m: GuildMember) => !m.user.bot).size > 0;
    if (!someoneInChannel) {
      return;
    }

    const existing = await voiceChannel.messages.fetch(panelMessageId).catch(() => null);
    if (!existing) {
      return;
    }

    await existing.delete().catch(() => null);

    const components = await this.buildPanelComponents(guildId, target.guild, site);
    const sent = await (voiceChannel as SendableChannels).send({
      components,
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });

    await prisma.guildSettings.update({
      where: { guildId },
      data: { [site.panelMessageIdField]: sent.id },
    });
  }

  private async runRefreshAllPanels(guildId: string): Promise<void> {
    const settings = await this.getGuildPanelSettings(guildId);
    if (!settings) {
      return;
    }

    for (const site of this.getActiveSites(settings)) {
      await this.runRefreshPanelForSite(guildId, site, settings);
    }
  }

  private async runRefreshPanelForSite(
    guildId: string,
    site: PhantomPanelSite,
    settings: GuildPanelSettings,
  ): Promise<void> {
    const target = await this.getPanelTarget(guildId, site, settings);
    if (!target) {
      return;
    }

    const { guild, voiceChannel } = target;
    const panelMessageId = settings[site.panelMessageIdField];
    const someoneInChannel = voiceChannel.members.filter((m: GuildMember) => !m.user.bot).size > 0;

    if (!someoneInChannel) {
      if (panelMessageId) {
        const old = await voiceChannel.messages.fetch(panelMessageId).catch(() => null);
        if (old) {
          await old.delete().catch(() => null);
        }
        await prisma.guildSettings.update({
          where: { guildId },
          data: { [site.panelMessageIdField]: null },
        });
      }
      return;
    }

    const components = await this.buildPanelComponents(guildId, guild, site);

    if (panelMessageId) {
      const existing = await voiceChannel.messages.fetch(panelMessageId).catch(() => null);
      if (existing) {
        try {
          await existing.edit({
            components,
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] },
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
      allowedMentions: { parse: [] },
    });

    await prisma.guildSettings.update({
      where: { guildId },
      data: { [site.panelMessageIdField]: sent.id },
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
      const member =
        guild.members.cache.get(a.user.discordId) ??
        (await guild.members.fetch(a.user.discordId).catch(() => null));
      if (member && !member.user.bot) {
        enrolled.push({ discordId: a.user.discordId, reason: a.phantomCompilerReason });
      }
    }
    return enrolled;
  }

  private getPatrollingEnrolledUsers(
    guild: Guild,
    patrolCategoryId: string | null,
    enrolled: EnrolledUser[],
  ): EnrolledUserOnPatrol[] {
    if (!patrolCategoryId || enrolled.length === 0) {
      return [];
    }

    const enrolledById = new Map(enrolled.map((e) => [e.discordId, e]));
    const onPatrol: EnrolledUserOnPatrol[] = [];
    const seen = new Set<string>();

    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased() || channel.parentId !== patrolCategoryId) {
        continue;
      }
      for (const member of channel.members.values()) {
        if (member.user.bot || seen.has(member.id)) {
          continue;
        }
        const enrolledUser = enrolledById.get(member.id);
        if (enrolledUser) {
          seen.add(member.id);
          onPatrol.push({
            ...enrolledUser,
            patrolChannelId: channel.id,
          });
        }
      }
    }

    return onPatrol;
  }

  private async buildPanelComponents(
    guildId: string,
    guild: Guild,
    site: PhantomPanelSite,
  ): Promise<ContainerBuilder[]> {
    const settings = await this.getGuildPanelSettings(guildId);
    const patrolCategoryId = settings?.patrolChannelCategoryId ?? null;

    const enrolled = await this.getEnrolledUsersInGuild(guild);
    const onPatrolUsers = this.getPatrollingEnrolledUsers(guild, patrolCategoryId, enrolled);
    const onPatrolIds = new Set(onPatrolUsers.map((u) => u.discordId));
    const notOnPatrolUsers = enrolled.filter((e) => !onPatrolIds.has(e.discordId));

    const siteLabel = site.key === "emt" ? "EMT" : "AoC";

    const headerContainer = new ContainerBuilder()
      .setAccentColor(Colors.Blurple)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            site.headerTitle,
            "",
            `_Live view of phantom-compiler enrollments. Updates when patrol or ${siteLabel} voice state changes._`,
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
