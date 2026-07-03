import { ButtonInteraction, GuildMember, MessageFlags } from "discord.js";
import { Discord, ButtonComponent } from "discordx";
import { exportApprovedEvents } from "../../../../managers/events/eventPlanningManager.js";
import { hasNode } from "../../../../utility/permissionNodes.js";

const DISCORD_MESSAGE_LIMIT = 2000;

function chunkText(text: string, maxLength = DISCORD_MESSAGE_LIMIT): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) {
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  return chunks;
}

function formatManualTemplateBlock(label: string, content: string): string {
  return `**${label}**\n\`\`\`\n${content}\n\`\`\``;
}

@Discord()
export class EventExportButtonHandlers {
  @ButtonComponent({ id: /^event:export:confirm:(\d+)(?::(manual|channel))?$/ })
  async handleExportConfirm(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = interaction.member as GuildMember | null;
    if (!member || !(await hasNode(member, "events.command.export"))) {
      await interaction.reply({
        content: "❌ You don't have permission to export events.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    const parts = interaction.customId.split(":");
    const mode = parts[4] === "channel" ? "channel" : "manual";
    const manualPost = mode === "manual";

    const result = await exportApprovedEvents(interaction.guild, interaction.user.id, {
      manualPost,
    });

    if (!result.success) {
      await interaction.editReply({
        content: `❌ ${result.error}`,
        embeds: [],
        components: [],
      });
      return;
    }

    const lines = (result.results ?? []).map((r) => {
      if (r.success) {
        return `✅ **${r.title}** — Discord event created`;
      }
      return `❌ **${r.title}** — ${r.error ?? "Failed"}`;
    });

    const deniedNote =
      result.deniedPendingCount && result.deniedPendingCount > 0
        ? `\n\n⚠️ **${result.deniedPendingCount} pending event(s)** were denied because they were not approved before export.`
        : "";

    if (manualPost && result.manualTemplates) {
      const templateParts: string[] = [];
      if (result.manualTemplates.onDuty) {
        templateParts.push(
          formatManualTemplateBlock("On-duty schedule", result.manualTemplates.onDuty),
        );
      }
      if (result.manualTemplates.offDuty) {
        templateParts.push(
          formatManualTemplateBlock("Off-duty schedule", result.manualTemplates.offDuty),
        );
      }

      const header =
        `✅ Export complete. Copy and post the schedule message(s) below.${deniedNote}\n\n` +
        `**Discord scheduled events:**\n${lines.join("\n")}\n\n`;

      const body = templateParts.join("\n\n");
      const fullMessage = header + body;
      const chunks = chunkText(fullMessage);

      await interaction.editReply({
        content: chunks[0],
        embeds: [],
        components: [],
      });

      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({
          content: chunks[i],
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    await interaction.editReply({
      content:
        `✅ Schedule posted to the on-duty and/or off-duty schedule channels.${deniedNote}\n\n**Export results:**\n${lines.join("\n")}`,
      embeds: [],
      components: [],
    });
  }

  @ButtonComponent({ id: /^event:export:cancel$/ })
  async handleExportCancel(interaction: ButtonInteraction): Promise<void> {
    await interaction.update({
      content: "❌ Export cancelled.",
      embeds: [],
      components: [],
    });
  }
}
