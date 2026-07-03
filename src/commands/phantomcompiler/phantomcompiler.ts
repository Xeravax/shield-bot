import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
  TextChannel,
  User,
} from "discord.js";
import { GuildGuard } from "../../utility/guards.js";
import { PermissionNodeGuard } from "../../utility/permissionNodes.js";
import { loggers } from "../../utility/logger.js";
import {
  REASON_OPTION_DESCRIPTION,
  buildPhantomCompilerSelfServicePanel,
  enrollPhantomCompiler,
  notifyPhantomCompilerEnrollment,
  notifyPhantomCompilerUnenroll,
  phantomCompilerPanelMessageFlags,
  scheduleAoCPanelRefresh,
  unenrollPhantomCompiler,
} from "../../utility/phantomCompilerService.js";

@Discord()
@SlashGroup({
  name: "phantomcompiler",
  description: "Phantom compiler / sensory needs",
})
@SlashGroup("phantomcompiler")
@Guard(GuildGuard)
export class PhantomCompilerCommands {
  @Slash({
    name: "panel",
    description: "Post a self-service phantom compiler enrollment panel in this channel",
  })
  @Guard(PermissionNodeGuard("phantomcompiler.command.panel"))
  async panel(interaction: CommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      await interaction.reply({
        content: "❌ Run this command in a server text channel where the panel should appear.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const textChannel = channel as TextChannel;
      await textChannel.send({
        components: [buildPhantomCompilerSelfServicePanel()],
        flags: phantomCompilerPanelMessageFlags,
        allowedMentions: { parse: [] },
      });

      await interaction.editReply({
        content: `✅ Phantom compiler panel posted in ${textChannel}.`,
      });
    } catch (error) {
      loggers.bot.error("phantomcompiler panel command error", error);
      await interaction.editReply({
        content: "❌ Failed to post the panel. Check the bot can send messages in this channel.",
      });
    }
  }

  @Slash({
    name: "enroll",
    description: "Enroll your MAIN verified VRChat account on the phantom compiler list",
  })
  async enroll(
    @SlashOption({
      name: "reason",
      description: REASON_OPTION_DESCRIPTION,
      type: ApplicationCommandOptionType.String,
      required: true,
      maxLength: 2000,
    })
    reason: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await enrollPhantomCompiler(interaction.user.id, reason);
      if (!result.ok) {
        await interaction.editReply({ content: result.message });
        return;
      }

      await notifyPhantomCompilerEnrollment(
        interaction.guildId,
        result.discordId,
        interaction.user.id,
        reason,
        false,
      );

      const message = result.updated
        ? "✅ Your phantom compiler enrollment has been updated."
        : "✅ You are enrolled on the phantom compiler list. Staff can see your needs on the AoC panel when you are on patrol.";

      await interaction.editReply({ content: message });
      scheduleAoCPanelRefresh(interaction.guildId);
    } catch (error) {
      loggers.bot.error("phantomcompiler enroll error", error);
      await interaction.editReply({
        content: "❌ Failed to enroll. Please try again later.",
      });
    }
  }

  @Slash({
    name: "add",
    description: "Enroll a member on the phantom compiler list (staff)",
  })
  @Guard(PermissionNodeGuard("phantomcompiler.command.add"))
  async add(
    @SlashOption({
      name: "user",
      description: "Member to enroll",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    target: User,
    @SlashOption({
      name: "reason",
      description: REASON_OPTION_DESCRIPTION,
      type: ApplicationCommandOptionType.String,
      required: true,
      maxLength: 2000,
    })
    reason: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await enrollPhantomCompiler(target.id, reason);
      if (!result.ok) {
        await interaction.editReply({ content: result.message });
        return;
      }

      await notifyPhantomCompilerEnrollment(
        interaction.guildId,
        result.discordId,
        interaction.user.id,
        reason,
        true,
      );

      const message = result.updated
        ? `✅ Updated phantom compiler enrollment for <@${target.id}>.`
        : `✅ Enrolled <@${target.id}> on the phantom compiler list.`;

      await interaction.editReply({ content: message });
      scheduleAoCPanelRefresh(interaction.guildId);
    } catch (error) {
      loggers.bot.error("phantomcompiler add error", error);
      await interaction.editReply({
        content: "❌ Failed to enroll member. Please try again later.",
      });
    }
  }

  @Slash({
    name: "unenroll",
    description: "Remove your phantom compiler enrollment",
  })
  async unenroll(interaction: CommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await unenrollPhantomCompiler(interaction.user.id);
      if (!result.ok) {
        await interaction.editReply({ content: result.message });
        return;
      }

      await notifyPhantomCompilerUnenroll(
        interaction.guildId,
        interaction.user.id,
        "slash",
      );

      await interaction.editReply({
        content: "✅ You have been removed from the phantom compiler list.",
      });

      scheduleAoCPanelRefresh(interaction.guildId);
    } catch (error) {
      loggers.bot.error("phantomcompiler unenroll error", error);
      await interaction.editReply({
        content: "❌ Failed to unenroll. Please try again later.",
      });
    }
  }
}
