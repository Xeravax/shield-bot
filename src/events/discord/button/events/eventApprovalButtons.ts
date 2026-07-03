import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { Discord, ButtonComponent } from "discordx";
import { prisma } from "../../../../main.js";
import { PlannedEventStatus } from "../../../../generated/prisma/client.js";
import { hasNode } from "../../../../utility/permissionNodes.js";
import {
  approvePlannedEvent,
  beginEventEditForHost,
  cancelPlannedEvent,
  refreshDraftPanel,
  updatePlanningChannelMessage,
} from "../../../../managers/events/eventPlanningManager.js";
import {
  memberHasHostNode,
  memberHasJrHostNode,
  memberIsFullHost,
  memberIsJrHostOnly,
} from "../../../../managers/events/eventRules.js";
import { loggers } from "../../../../utility/logger.js";

async function canManageEvents(member: GuildMember): Promise<boolean> {
  return hasNode(member, "events.manage.approve");
}

@Discord()
export class EventApprovalButtonHandlers {
  @ButtonComponent({ id: /^event:approve:(\d+)$/ })
  async handleApprove(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = interaction.member as GuildMember | null;
    if (!member || !(await canManageEvents(member))) {
      await interaction.reply({
        content: "❌ You don't have permission to approve events.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();
    const eventId = parseInt(interaction.customId.split(":")[2], 10);

    try {
      const result = await approvePlannedEvent(eventId, interaction.user.id, interaction.guild);
      if (!result.success) {
        await interaction.followUp({
          content: `❌ ${result.error}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      loggers.bot.error("Error approving event", error);
      await interaction.followUp({
        content: "❌ An error occurred while approving the event.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /** No @Guard — showModal must run immediately. */
  @ButtonComponent({ id: /^event:deny:(\d+)$/ })
  async handleDeny(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const eventId = parseInt(interaction.customId.split(":")[2], 10);
    const reasonInput = new TextInputBuilder()
      .setCustomId("reason")
      .setLabel("Denial reason")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000)
      .setPlaceholder("Why is this event being denied?");

    const modal = new ModalBuilder()
      .setCustomId(`event-modal:deny:${eventId}`)
      .setTitle("Deny event")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));

    try {
      await interaction.showModal(modal);
    } catch (err) {
      loggers.bot.error("event deny modal failed", err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ Could not open the form. Please try again.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
      }
    }
  }

  @ButtonComponent({ id: /^event:cohost:(\d+)$/ })
  async handleCoHostRequest(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = interaction.member as GuildMember | null;
    if (!member) {
      await interaction.reply({
        content: "❌ Unable to verify permissions.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const eventId = parseInt(interaction.customId.split(":")[2], 10);
    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== PlannedEventStatus.PENDING) {
      await interaction.reply({
        content: "❌ Event is not open for co-host requests.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!event.coHostOpen || event.coHostId) {
      await interaction.reply({
        content: "❌ Co-host is not open for this event.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (event.pendingCoHostUserId) {
      await interaction.reply({
        content: "❌ Another co-host request is already pending.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id === event.hostId) {
      await interaction.reply({
        content: "❌ The host cannot request to be their own co-host.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const hasHost = await memberHasHostNode(member);
    const hasJr = await memberHasJrHostNode(member);
    if (!hasHost && !hasJr) {
      await interaction.reply({
        content: "❌ You need the Host or Jr. Host role to request co-host.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const hostMember = await interaction.guild.members.fetch(event.hostId).catch(() => null);
    if (hostMember && (await memberIsJrHostOnly(hostMember))) {
      if (!(await memberIsFullHost(member))) {
        await interaction.reply({
          content: "❌ Jr. Host events only accept a full Host as co-host.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferUpdate();

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: event.guildId },
    });
    if (!settings?.eventPlanningChannelId) {
      await interaction.followUp({
        content: "❌ Planning channel not configured.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await prisma.plannedEvent.update({
      where: { id: eventId },
      data: { pendingCoHostUserId: interaction.user.id },
    });

    const acceptBtn = new ButtonBuilder()
      .setCustomId(`event:cohost-accept:${eventId}:${interaction.user.id}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success);
    const denyBtn = new ButtonBuilder()
      .setCustomId(`event:cohost-deny:${eventId}:${interaction.user.id}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(acceptBtn, denyBtn);

    const channel = await interaction.client.channels.fetch(settings.eventPlanningChannelId);
    if (channel?.isTextBased() && !channel.isDMBased()) {
      const reqMsg = await channel.send({
        content: `<@${interaction.user.id}> requested to become co-host for **${event.title}**. <@${event.hostId}>, do you accept?`,
        components: [row],
        allowedMentions: { users: [event.hostId, interaction.user.id] },
      });
      await prisma.plannedEvent.update({
        where: { id: eventId },
        data: { coHostRequestMessageId: reqMsg.id },
      });
    }

    const refreshed = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (refreshed) {
      await updatePlanningChannelMessage(interaction.guild, refreshed);
    }
  }

  @ButtonComponent({ id: /^event:resubmit:(\d+)$/ })
  async handleResubmitLegacy(interaction: ButtonInteraction): Promise<void> {
    interaction.customId = interaction.customId.replace("event:resubmit:", "event:edit:");
    return this.handleEdit(interaction);
  }

  @ButtonComponent({ id: /^event:edit:(\d+)$/ })
  async handleEdit(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const eventId = parseInt(interaction.customId.split(":")[2], 10);

    const result = await beginEventEditForHost(
      eventId,
      interaction.guild,
      interaction.user.id,
    );
    if (!result.success) {
      await interaction.reply({
        content: `❌ ${result.error}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { embed, components } = await refreshDraftPanel(eventId, interaction.guild);
    await interaction.editReply({ embeds: [embed], components });
  }

  @ButtonComponent({ id: /^event:cancel:(\d+)$/ })
  async handleCancel(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const eventId = parseInt(interaction.customId.split(":")[2], 10);
    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (
      !event ||
      (event.status !== PlannedEventStatus.PENDING &&
        event.status !== PlannedEventStatus.APPROVED)
    ) {
      await interaction.reply({
        content: "❌ This event cannot be cancelled.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = interaction.member as GuildMember | null;
    const isHost = interaction.user.id === event.hostId;
    const isStaff = member ? await canManageEvents(member) : false;
    if (!isHost && !isStaff) {
      await interaction.reply({
        content: "❌ Only the event host or event leads can cancel this event.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    try {
      const result = await cancelPlannedEvent(
        eventId,
        interaction.guild,
        interaction.user.id,
      );
      if (!result.success) {
        await interaction.followUp({
          content: `❌ ${result.error}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.followUp({
        content: `✅ **${event.title}** cancelled. It no longer counts toward <@${event.hostId}>'s weekly event limit.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      loggers.bot.error("Error cancelling event", error);
      await interaction.followUp({
        content: "❌ An error occurred while cancelling the event.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @ButtonComponent({ id: /^event:cancel-approved:(\d+)$/ })
  async handleCancelApprovedLegacy(interaction: ButtonInteraction): Promise<void> {
    interaction.customId = interaction.customId.replace(
      "event:cancel-approved:",
      "event:cancel:",
    );
    return this.handleCancel(interaction);
  }
}
