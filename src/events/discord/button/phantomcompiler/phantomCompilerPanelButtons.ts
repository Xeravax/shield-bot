import {
  ActionRowBuilder,
  ButtonInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { Discord, ButtonComponent, ModalComponent } from "discordx";
import { loggers } from "../../../../utility/logger.js";
import {
  PHANTOM_PC_BUTTON_ENROLL,
  PHANTOM_PC_BUTTON_UNENROLL,
  PHANTOM_PC_MODAL_ENROLL,
  enrollPhantomCompiler,
  notifyPhantomCompilerEnrollment,
  notifyPhantomCompilerUnenroll,
  scheduleAoCPanelRefresh,
  unenrollPhantomCompiler,
} from "../../../../utility/phantomCompilerService.js";

@Discord()
export class PhantomCompilerPanelButtonHandlers {
  /** No @Guard — showModal must run immediately (Discord 3s ack window). */
  @ButtonComponent({ id: PHANTOM_PC_BUTTON_ENROLL })
  async handleEnrollButton(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reasonInput = new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Phantom / sensory needs")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000)
      .setPlaceholder("Describe what staff should know (line breaks allowed)");

    const modal = new ModalBuilder()
      .setCustomId(PHANTOM_PC_MODAL_ENROLL)
      .setTitle("Phantom compiler enrollment")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));

    try {
      await interaction.showModal(modal);
    } catch (err) {
      loggers.bot.error("phantomcompiler panel enroll modal failed", err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "❌ Could not open the form. Please try again.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => null);
      }
    }
  }

  @ButtonComponent({ id: PHANTOM_PC_BUTTON_UNENROLL })
  async handleUnenrollButton(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
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
        "panel",
      );
      scheduleAoCPanelRefresh(interaction.guildId);

      await interaction.editReply({
        content: "✅ You have been removed from the phantom compiler list.",
      });
    } catch (err) {
      loggers.bot.error("phantomcompiler panel unenroll error", err);
      await interaction.editReply({
        content: "❌ Failed to unenroll. Please try again later.",
      });
    }
  }

  @ModalComponent({ id: PHANTOM_PC_MODAL_ENROLL })
  async handleEnrollModal(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = interaction.fields.getTextInputValue("reason").trim();
    if (!reason) {
      await interaction.reply({
        content: "❌ A reason is required.",
        flags: MessageFlags.Ephemeral,
      });
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
      scheduleAoCPanelRefresh(interaction.guildId);

      const message = result.updated
        ? "✅ Your phantom compiler enrollment has been updated."
        : "✅ You are enrolled on the phantom compiler list. Staff can see your needs on the AoC panel when you are on patrol.";

      await interaction.editReply({ content: message });
    } catch (err) {
      loggers.bot.error("phantomcompiler panel enroll submit error", err);
      await interaction.editReply({
        content: "❌ Failed to enroll. Please try again later.",
      });
    }
  }
}
