import { ArgsOf, Discord, On } from "discordx";
import { aocPanelManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

@Discord()
export class AoCMessageHandler {
  @On({ event: "messageCreate" })
  async onMessage([message]: ArgsOf<"messageCreate">): Promise<void> {
    if (message.author.bot || !message.guildId) {
      return;
    }

    try {
      await aocPanelManager.onMessageInPhantomPanelVoiceChat(
        message.guildId,
        message.channelId,
        message.id,
      );
    } catch (err) {
      loggers.bot.error("AoC messageCreate handler error", err);
    }
  }
}
