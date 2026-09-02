import {
  ApplicationCommandType,
  type ApplicationCommandDataResolvable,
  type Client,
} from "discord.js";
import { loggers } from "../logger.js";

/**
 * discordx bulk-overwrites application commands and omits Discord's Activity
 * Entry Point (type 4). Discord rejects that with API error 50240 — so merge
 * any existing Entry Point command(s) into the payload before set().
 */
export async function initApplicationCommandsPreservingEntryPoint(
  bot: Client & { initApplicationCommands: () => Promise<void> },
): Promise<void> {
  const manager = bot.application?.commands;
  if (!manager) {
    await bot.initApplicationCommands();
    return;
  }

  const originalSet = manager.set.bind(manager);

  manager.set = (async (
    commands: readonly ApplicationCommandDataResolvable[],
    guildId?: string,
  ) => {
    // Entry Point commands are global-only; guild bulk updates are unaffected.
    if (guildId) {
      return originalSet(commands, guildId);
    }

    const existing = await manager.fetch();
    const entryPoints = [...existing.values()].filter(
      (command) => command.type === ApplicationCommandType.PrimaryEntryPoint,
    );

    if (entryPoints.length === 0) {
      return originalSet(commands, guildId);
    }

    const merged: ApplicationCommandDataResolvable[] = [...commands];
    for (const entry of entryPoints) {
      const alreadyIncluded = merged.some(
        (command) =>
          typeof command === "object" &&
          command !== null &&
          "type" in command &&
          command.type === ApplicationCommandType.PrimaryEntryPoint &&
          "name" in command &&
          command.name === entry.name,
      );
      if (alreadyIncluded) {
        continue;
      }

      merged.push({
        name: entry.name,
        type: ApplicationCommandType.PrimaryEntryPoint,
        // DISCORD_LAUNCH_ACTIVITY — Discord launches the Activity itself
        handler: entry.handler ?? 2,
      } as ApplicationCommandDataResolvable);

      loggers.bot.info(
        `Preserving Activity Entry Point command "${entry.name}" during bulk command sync`,
      );
    }

    return originalSet(merged, guildId);
  }) as typeof manager.set;

  try {
    await bot.initApplicationCommands();
  } finally {
    manager.set = originalSet;
  }
}
