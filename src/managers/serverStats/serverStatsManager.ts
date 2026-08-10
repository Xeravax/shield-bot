import {
  ChannelType,
  Client,
  Guild,
  PermissionFlagsBits,
  type GuildChannel,
} from "discord.js";
import { prisma } from "../../main.js";
import { getRoleIdsWithNode } from "../../utility/permissionNodes.js";
import { loggers } from "../../utility/logger.js";

export type ServerStatsKind = "goal" | "members" | "deputies" | "boosts";

export type ServerStatsValues = {
  goal: number;
  members: number;
  deputies: number;
  boosts: number;
};

const GOAL_STEP = 500;
const DEBOUNCE_MS = 30_000;
const CHANNEL_FIELD_BY_KIND: Record<
  ServerStatsKind,
  | "serverStatsGoalChannelId"
  | "serverStatsMembersChannelId"
  | "serverStatsDeputiesChannelId"
  | "serverStatsBoostsChannelId"
> = {
  goal: "serverStatsGoalChannelId",
  members: "serverStatsMembersChannelId",
  deputies: "serverStatsDeputiesChannelId",
  boosts: "serverStatsBoostsChannelId",
};

const LABEL_BY_KIND: Record<ServerStatsKind, string> = {
  goal: "Current Goal",
  members: "Members",
  deputies: "Deputies",
  boosts: "Boosts",
};

export function computeMemberGoal(members: number): number {
  if (members <= 0) {
    return GOAL_STEP;
  }
  const ceiling = Math.ceil(members / GOAL_STEP) * GOAL_STEP;
  return ceiling === members ? members + GOAL_STEP : ceiling;
}

export function formatServerStatsChannelName(
  kind: ServerStatsKind,
  value: number,
): string {
  return `🔰 | ${LABEL_BY_KIND[kind]}: ${value}`;
}

export class ServerStatsManager {
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly client: Client) {}

  queueRefresh(guildId: string): void {
    const existing = this.pendingTimers.get(guildId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.pendingTimers.delete(guildId);
      void this.updateGuild(guildId);
    }, DEBOUNCE_MS);
    this.pendingTimers.set(guildId, timer);
  }

  async computeStats(guild: Guild): Promise<ServerStatsValues> {
    const members = guild.memberCount;
    const boosts = guild.premiumSubscriptionCount ?? 0;
    const deputies = await this.countDeputies(guild);
    return {
      members,
      boosts,
      deputies,
      goal: computeMemberGoal(members),
    };
  }

  async updateGuild(guildId: string): Promise<ServerStatsValues | null> {
    if (this.inFlight.has(guildId)) {
      this.queueRefresh(guildId);
      return null;
    }
    this.inFlight.add(guildId);
    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
        select: {
          serverStatsGoalChannelId: true,
          serverStatsMembersChannelId: true,
          serverStatsDeputiesChannelId: true,
          serverStatsBoostsChannelId: true,
        },
      });

      if (!settings) {
        return null;
      }

      const hasAnyChannel =
        settings.serverStatsGoalChannelId ||
        settings.serverStatsMembersChannelId ||
        settings.serverStatsDeputiesChannelId ||
        settings.serverStatsBoostsChannelId;
      if (!hasAnyChannel) {
        return null;
      }

      const guild = await this.client.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        loggers.bot.warn(`Server stats: guild ${guildId} not found`);
        return null;
      }

      const stats = await this.computeStats(guild);
      const updates: Array<{ kind: ServerStatsKind; channelId: string; value: number }> =
        [];

      for (const kind of Object.keys(CHANNEL_FIELD_BY_KIND) as ServerStatsKind[]) {
        const channelId = settings[CHANNEL_FIELD_BY_KIND[kind]];
        if (channelId) {
          updates.push({ kind, channelId, value: stats[kind] });
        }
      }

      for (const { kind, channelId, value } of updates) {
        await this.renameIfNeeded(guild, channelId, kind, value);
      }

      return stats;
    } catch (error) {
      loggers.bot.error(`Server stats update failed for guild ${guildId}`, error);
      return null;
    } finally {
      this.inFlight.delete(guildId);
    }
  }

  async updateAllConfiguredGuilds(): Promise<void> {
    const guildSettings = await prisma.guildSettings.findMany({
      where: {
        OR: [
          { serverStatsGoalChannelId: { not: null } },
          { serverStatsMembersChannelId: { not: null } },
          { serverStatsDeputiesChannelId: { not: null } },
          { serverStatsBoostsChannelId: { not: null } },
        ],
      },
      select: { guildId: true },
    });

    for (const { guildId } of guildSettings) {
      await this.updateGuild(guildId);
    }
  }

  async createSetup(guild: Guild): Promise<{
    categoryId: string;
    goalChannelId: string;
    membersChannelId: string;
    deputiesChannelId: string;
    boostsChannelId: string;
    stats: ServerStatsValues;
  }> {
    const stats = await this.computeStats(guild);
    const everyoneId = guild.roles.everyone.id;

    const category = await guild.channels.create({
      name: "Server Stats",
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: everyoneId,
          allow: [PermissionFlagsBits.ViewChannel],
          deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
        },
      ],
    });

    const createVoice = async (kind: ServerStatsKind) =>
      guild.channels.create({
        name: formatServerStatsChannelName(kind, stats[kind]),
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: [
          {
            id: everyoneId,
            allow: [PermissionFlagsBits.ViewChannel],
            deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
          },
        ],
      });

    const [goalChannel, membersChannel, deputiesChannel, boostsChannel] =
      await Promise.all([
        createVoice("goal"),
        createVoice("members"),
        createVoice("deputies"),
        createVoice("boosts"),
      ]);

    await prisma.guildSettings.upsert({
      where: { guildId: guild.id },
      update: {
        serverStatsCategoryId: category.id,
        serverStatsGoalChannelId: goalChannel.id,
        serverStatsMembersChannelId: membersChannel.id,
        serverStatsDeputiesChannelId: deputiesChannel.id,
        serverStatsBoostsChannelId: boostsChannel.id,
      },
      create: {
        guildId: guild.id,
        serverStatsCategoryId: category.id,
        serverStatsGoalChannelId: goalChannel.id,
        serverStatsMembersChannelId: membersChannel.id,
        serverStatsDeputiesChannelId: deputiesChannel.id,
        serverStatsBoostsChannelId: boostsChannel.id,
      },
    });

    return {
      categoryId: category.id,
      goalChannelId: goalChannel.id,
      membersChannelId: membersChannel.id,
      deputiesChannelId: deputiesChannel.id,
      boostsChannelId: boostsChannel.id,
      stats,
    };
  }

  private async countDeputies(guild: Guild): Promise<number> {
    const roleIds = await getRoleIdsWithNode(guild.id, "patrol.tracked");
    if (roleIds.length === 0) {
      return 0;
    }

    // Ensure member cache is reasonably complete for role.members
    if (guild.members.cache.size < guild.memberCount * 0.9) {
      try {
        await guild.members.fetch();
      } catch (error) {
        loggers.bot.warn(
          `Server stats: could not fetch members for deputy count in ${guild.id}`,
          error,
        );
      }
    }

    const unique = new Set<string>();
    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
      if (!role) {
        continue;
      }
      for (const memberId of role.members.keys()) {
        unique.add(memberId);
      }
    }
    return unique.size;
  }

  private async renameIfNeeded(
    guild: Guild,
    channelId: string,
    kind: ServerStatsKind,
    value: number,
  ): Promise<void> {
    const desired = formatServerStatsChannelName(kind, value);
    let channel: GuildChannel | null = null;
    try {
      const fetched = await guild.channels.fetch(channelId);
      channel = fetched as GuildChannel | null;
    } catch {
      loggers.bot.warn(
        `Server stats: channel ${channelId} missing in guild ${guild.id} (${kind})`,
      );
      return;
    }

    if (!channel || channel.type !== ChannelType.GuildVoice) {
      loggers.bot.warn(
        `Server stats: channel ${channelId} is not a voice channel (${kind})`,
      );
      return;
    }

    if (channel.name === desired) {
      return;
    }

    try {
      await channel.setName(desired, "Server stats refresh");
    } catch (error) {
      loggers.bot.warn(
        `Server stats: failed to rename ${kind} channel ${channelId} in ${guild.id}`,
        error,
      );
    }
  }
}
