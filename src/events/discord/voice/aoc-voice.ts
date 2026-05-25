import { ArgsOf, Discord, On } from "discordx";
import { prisma, aocPanelManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
export class AoCVoiceStateHandler {
  @On({ event: "voiceStateUpdate" })
  async onVoiceStateUpdate([oldState, newState]: ArgsOf<"voiceStateUpdate">): Promise<void> {
    const guildId = newState.guild.id;
    if (!guildId) {
      return;
    }

    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
        select: { aocVoiceChannelId: true },
      });
      const aocVoiceId = settings?.aocVoiceChannelId;
      if (!aocVoiceId) {
        return;
      }

      const wasInAoC = oldState.channelId === aocVoiceId;
      const nowInAoC = newState.channelId === aocVoiceId;
      const aocAffected = wasInAoC || nowInAoC;

      if (!aocAffected) {
        return;
      }

      if (nowInAoC && !wasInAoC) {
        await aocPanelManager.onAoCVoiceJoin(guildId);
      } else {
        aocPanelManager.scheduleRefresh(guildId);
      }
    } catch (err) {
      loggers.bot.error("AoC voiceStateUpdate handler error", err);
    }
  }
}
