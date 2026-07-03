import {
  ActionRowBuilder,
  ButtonInteraction,
  Colors,
  ContainerBuilder,
  GuildMember,
  Message,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { Discord, ButtonComponent, ModalComponent } from "discordx";
import { patrolTimer } from "../../../../main.js";
import { loggers } from "../../../../utility/logger.js";
import { hasNode } from "../../../../utility/permissionNodes.js";
import { respondWithError } from "../../../../utility/generalUtils.js";

const BUTTON_PREFIX = "patrol-session-remove:";
/** Short prefix — modal custom_id max 100 chars (guild + user + two timestamps). */
const MODAL_PREFIX = "psr-m:";
const LEGACY_MODAL_PREFIX = "patrol-session-remove-modal:";

type ParsedSession = {
  guildId: string;
  userId: string;
  startMs: number;
  endMs: number;
};

function modalPrefixFromCustomId(customId: string): string | null {
  if (customId.startsWith(MODAL_PREFIX)) {
    return MODAL_PREFIX;
  }
  if (customId.startsWith(LEGACY_MODAL_PREFIX)) {
    return LEGACY_MODAL_PREFIX;
  }
  return null;
}

/** patrol-session-remove:guildId:userId:startMs:endMs */
function parseSessionCustomId(customId: string, prefix: string): ParsedSession | null {
  if (!customId.startsWith(prefix)) {
    return null;
  }
  const parts = customId.slice(prefix.length).split(":");
  if (parts.length < 4) {
    return null;
  }
  const startMs = Number(parts[2]);
  const endMs = Number(parts[3]);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  return { guildId: parts[0], userId: parts[1], startMs, endMs };
}

function buildModalCustomId(parsed: ParsedSession): string {
  return `${MODAL_PREFIX}${parsed.guildId}:${parsed.userId}:${parsed.startMs}:${parsed.endMs}`;
}

async function applyPatrolSessionRemoval(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  parsed: ParsedSession,
  reason: string,
  logMessage: Message | null,
): Promise<void> {
  const { guildId, userId, startMs, endMs } = parsed;
  const durationMs = endMs - startMs;

  await patrolTimer.subtractPatrolSessionTime(
    guildId,
    userId,
    new Date(startMs),
    new Date(endMs),
  );

  const durationStr = patrolTimer.formatDurationPublic(durationMs);
  const resolvedContent = [
    "**Patrol session — time removed**",
    "",
    `❌ Staff removed **${durationStr}** from <@${userId}>'s patrol totals for this session.`,
    "",
    "**Reason**",
    reason,
    "",
    `**Removed by** <@${interaction.user.id}>`,
    "",
    `<t:${Math.floor(Date.now() / 1000)}:F>`,
  ].join("\n");

  const container = new ContainerBuilder()
    .setAccentColor(Colors.Red)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(resolvedContent));

  if (logMessage?.editable) {
    await logMessage.edit({
      content: "",
      embeds: [],
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [] },
    });
  }

  await patrolTimer.logCommandUsage(
    guildId,
    "patrol-session-remove",
    interaction.user.id,
    userId,
    `Removed ${durationStr} (session ${startMs}–${endMs}). Reason: ${reason}`,
  );
}

@Discord()
export class PatrolSessionRemoveButtonHandlers {
  /**
   * No @Guard here — staff is checked on modal submit. Guards that hit Prisma
   * before showModal caused Unknown interaction (10062).
   */
  @ButtonComponent({ id: /^patrol-session-remove:\d+:\d+:\d+:\d+$/ })
  async handleRemove(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseSessionCustomId(interaction.customId, BUTTON_PREFIX);
    if (!parsed) {
      await interaction.reply({
        content: "❌ Invalid button data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (parsed.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "❌ This button belongs to a different server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reasonInput = new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Reason for removing patrol time")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000)
      .setPlaceholder("Why is this session time being removed?");

    const modal = new ModalBuilder()
      .setCustomId(buildModalCustomId(parsed))
      .setTitle("Remove patrol session time")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));

    try {
      await interaction.showModal(modal);
    } catch (err) {
      loggers.patrol.error("Failed to open patrol session remove modal", err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "❌ Could not open the form in time. Please click **Remove time** again.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => null);
      }
    }
  }

  @ModalComponent({ id: /^psr-m:|^patrol-session-remove-modal:/ })
  async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await respondWithError(interaction, "❌ This can only be used in a server.");
      return;
    }

    const member = interaction.member as GuildMember | null;
    if (!member) {
      await respondWithError(interaction, "Unable to verify your permissions.");
      return;
    }

    if (!(await hasNode(member, "patrol.manage.session-remove"))) {
      await respondWithError(
        interaction,
        "You don't have permission to use this. Missing node: patrol.manage.session-remove",
      );
      return;
    }

    const modalPrefix = modalPrefixFromCustomId(interaction.customId);
    if (!modalPrefix) {
      await interaction.reply({
        content: "❌ Invalid modal data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const parsed = parseSessionCustomId(interaction.customId, modalPrefix);
    if (!parsed) {
      await interaction.reply({
        content: "❌ Invalid modal data.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (parsed.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "❌ This form belongs to a different server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = interaction.fields.getTextInputValue("reason").trim();
    if (!reason) {
      await interaction.reply({
        content: "❌ A reason is required to remove patrol time.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const durationMs = parsed.endMs - parsed.startMs;
      const durationStr = patrolTimer.formatDurationPublic(durationMs);
      const logMessage = interaction.message;

      await applyPatrolSessionRemoval(interaction, parsed, reason, logMessage);

      await interaction.editReply({
        content: `✅ Removed **${durationStr}** from <@${parsed.userId}>'s patrol time for this session.`,
      });
    } catch (err) {
      loggers.patrol.error("Patrol session remove error", err);
      await interaction.editReply({
        content: "❌ Failed to remove patrol time.",
      });
    }
  }
}
