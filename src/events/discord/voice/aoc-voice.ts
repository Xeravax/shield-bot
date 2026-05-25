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
        select: { aocVoiceChannelId: true, emtVoiceChannelId: true },
      });

      const panelVoiceIds = [
        settings?.aocVoiceChannelId,
        settings?.emtVoiceChannelId,
      ].filter((id): id is string => !!id);

      if (panelVoiceIds.length === 0) {
        return;
      }

      const wasInPanel = oldState.channelId && panelVoiceIds.includes(oldState.channelId);
      const nowInPanel = newState.channelId && panelVoiceIds.includes(newState.channelId);
      const panelAffected = wasInPanel || nowInPanel;

      if (!panelAffected) {
        return;
      }

      if (nowInPanel && !wasInPanel) {
        await aocPanelManager.onPhantomPanelVoiceJoin(guildId);
      } else {
        aocPanelManager.scheduleRefresh(guildId);
      }
    } catch (err) {
      loggers.bot.error("Phantom panel voiceStateUpdate handler error", err);
    }
  }
}
