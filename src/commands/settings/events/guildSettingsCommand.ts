import { CommandInteraction, MessageFlags } from "discord.js";
import type { GuildSettings, Prisma } from "../../../generated/prisma/client.js";
import { patrolTimer, prisma } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

export async function requireGuild(
  interaction: CommandInteraction,
): Promise<string | null> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  return interaction.guildId;
}

export async function readGuildSetting<T>(
  guildId: string,
  getter: (settings: GuildSettings | null) => T,
): Promise<T> {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
  });
  return getter(settings);
}

export async function upsertGuildSetting(
  guildId: string,
  data: {
    update: Prisma.GuildSettingsUpdateInput;
    create: Prisma.GuildSettingsCreateInput;
  },
  logKey: string,
  userId: string,
  channelId?: string,
): Promise<void> {
  await prisma.guildSettings.upsert({
    where: { guildId },
    update: data.update,
    create: data.create,
  });

  await patrolTimer.logCommandUsage(
    guildId,
    logKey,
    userId,
    undefined,
    channelId,
  );
}

export async function handleGuildSettingsError(
  interaction: CommandInteraction,
  error: unknown,
  logMessage: string,
): Promise<void> {
  loggers.bot.error(logMessage, error);
  const payload = {
    content: "❌ Failed to set channel. Please try again.",
    flags: MessageFlags.Ephemeral as const,
  };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => {});
  } else {
    await interaction.reply(payload);
  }
}
