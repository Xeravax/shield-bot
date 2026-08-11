import { ArgsOf, Discord, On } from "discordx";
import { AuditLogEvent } from "discord.js";
import { auditLogManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import { auditExecutorFields } from "../../../managers/logging/index.js";

@Discord()
export class LoggingSoundboardEvents {
  @On({ event: "guildSoundboardSoundCreate" })
  async onCreate([
    sound,
  ]: ArgsOf<"guildSoundboardSoundCreate">): Promise<void> {
    try {
      if (!sound.guild) {
        return;
      }
      const { fields: extra, components } = await auditExecutorFields(
        sound.guild,
        AuditLogEvent.SoundboardSoundCreate,
        sound.soundId,
      );
      await auditLogManager.postLog({
        guildId: sound.guild.id,
        category: "server",
        title: "Soundboard Sound Created",
        severity: "success",
        fields: [
          {
            name: "Sound",
            value: `${sound.name} (\`${sound.soundId}\`)`,
          },
          ...extra,
        ],
        components,
      });
    } catch (error) {
      loggers.bot.debug("guildSoundboardSoundCreate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "guildSoundboardSoundUpdate" })
  async onUpdate([
    oldSound,
    newSound,
  ]: ArgsOf<"guildSoundboardSoundUpdate">): Promise<void> {
    try {
      if (!newSound.guild || !oldSound) {
        return;
      }
      const changes: string[] = [];
      if (oldSound.name !== newSound.name) {
        changes.push(`Name: \`${oldSound.name}\` → \`${newSound.name}\``);
      }
      const oldEmoji = oldSound.emoji?.id ?? oldSound.emoji?.name ?? null;
      const newEmoji = newSound.emoji?.id ?? newSound.emoji?.name ?? null;
      if (oldEmoji !== newEmoji) {
        changes.push("Emoji changed");
      }
      if (oldSound.volume !== newSound.volume) {
        changes.push(`Volume: ${oldSound.volume} → ${newSound.volume}`);
      }
      if (changes.length === 0) {
        return;
      }
      const { fields: extra, components } = await auditExecutorFields(
        newSound.guild,
        AuditLogEvent.SoundboardSoundUpdate,
        newSound.soundId,
      );
      await auditLogManager.postLog({
        guildId: newSound.guild.id,
        category: "server",
        title: "Soundboard Sound Updated",
        severity: "info",
        fields: [
          {
            name: "Sound",
            value: `${newSound.name} (\`${newSound.soundId}\`)`,
          },
          { name: "Changes", value: changes.join("\n") },
          ...extra,
        ],
        components,
      });
    } catch (error) {
      loggers.bot.debug("guildSoundboardSoundUpdate log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "guildSoundboardSoundDelete" })
  async onDelete([
    sound,
  ]: ArgsOf<"guildSoundboardSoundDelete">): Promise<void> {
    try {
      if (!sound.guildId) {
        return;
      }
      const guild =
        sound.guild ??
        (await sound.client.guilds.fetch(sound.guildId).catch(() => null));
      const { fields: extra, components } = guild
        ? await auditExecutorFields(
            guild,
            AuditLogEvent.SoundboardSoundDelete,
            sound.soundId,
          )
        : { fields: [], components: undefined };
      await auditLogManager.postLog({
        guildId: sound.guildId,
        category: "server",
        title: "Soundboard Sound Deleted",
        severity: "danger",
        fields: [
          {
            name: "Sound",
            value: `${sound.name ?? "unknown"} (\`${sound.soundId}\`)`,
          },
          ...extra,
        ],
        components,
      });
    } catch (error) {
      loggers.bot.debug("guildSoundboardSoundDelete log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
