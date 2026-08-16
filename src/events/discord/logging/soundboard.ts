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
      const { fields: extra, components, entryId } = await auditExecutorFields(
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
        auditEntryId: entryId,
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
      const { fields: extra, components, entryId } = await auditExecutorFields(
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
        auditEntryId: entryId,
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
      const { fields: extra, components, entryId } = guild
        ? await auditExecutorFields(
            guild,
            AuditLogEvent.SoundboardSoundDelete,
            sound.soundId,
          )
        : { fields: [], components: undefined, entryId: null };
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
        auditEntryId: entryId,
      });
    } catch (error) {
      loggers.bot.debug("guildSoundboardSoundDelete log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @On({ event: "voiceChannelEffectSend" })
  async onEffectSend([
    effect,
  ]: ArgsOf<"voiceChannelEffectSend">): Promise<void> {
    try {
      // Only log soundboard usage, not every VC emoji animation
      if (effect.soundId == null) {
        return;
      }
      const guild = effect.guild;
      const sound =
        effect.soundboardSound ??
        guild.soundboardSounds.cache.get(String(effect.soundId)) ??
        null;
      const user = await guild.client.users
        .fetch(effect.userId)
        .catch(() => null);
      await auditLogManager.postLog({
        guildId: guild.id,
        category: "voice",
        title: "Soundboard Used",
        severity: "info",
        fields: [
          {
            name: "User",
            value: await auditLogManager.formatUser(
              effect.userId,
              user?.username ?? null,
            ),
          },
          {
            name: "Channel",
            value: auditLogManager.formatChannel(effect.channelId),
          },
          {
            name: "Sound",
            value: sound
              ? `${sound.name} (\`${effect.soundId}\`)`
              : `\`${effect.soundId}\``,
          },
        ],
        sourceChannelId: effect.channelId,
      });
    } catch (error) {
      loggers.bot.debug("voiceChannelEffectSend log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
