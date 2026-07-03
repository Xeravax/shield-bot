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
import { matchComponentId } from "../../../../utility/componentId.js";
import {
  approvePlannedEvent,
  beginEventEditForHost,
  cancelPlannedEvent,
  isEventLocked,
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

const EVENT_APPROVE_PATTERN = /^event:approve:(\d+)$/;
const EVENT_DENY_PATTERN = /^event:deny:(\d+)$/;
const EVENT_COHOST_PATTERN = /^event:cohost:(\d+)$/;
const EVENT_RESUBMIT_PATTERN = /^event:resubmit:(\d+)$/;
const EVENT_EDIT_PATTERN = /^event:edit:(\d+)$/;
const EVENT_CANCEL_PATTERN = /^event:cancel:(\d+)$/;
const EVENT_CANCEL_APPROVED_PATTERN = /^event:cancel-approved:(\d+)$/;

async function canManageEvents(member: GuildMember): Promise<boolean> {
  return hasNode(member, "events.manage.approve");
}

@Discord()
export class EventApprovalButtonHandlers {
  @ButtonComponent({ id: EVENT_APPROVE_PATTERN })
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

    const match = matchComponentId(interaction.customId, EVENT_APPROVE_PATTERN);
    if (!match) return;

    await interaction.deferUpdate();
    const eventId = parseInt(match[1], 10);

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
  @ButtonComponent({ id: EVENT_DENY_PATTERN })
  async handleDeny(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const match = matchComponentId(interaction.customId, EVENT_DENY_PATTERN);
    if (!match) return;

    const eventId = parseInt(match[1], 10);
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

  @ButtonComponent({ id: EVENT_COHOST_PATTERN })
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

    const match = matchComponentId(interaction.customId, EVENT_COHOST_PATTERN);
    if (!match) return;

    const eventId = parseInt(match[1], 10);
    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    const coHostRequestOpen =
      event &&
      (event.status === PlannedEventStatus.PENDING ||
        event.status === PlannedEventStatus.APPROVED);
    if (!coHostRequestOpen || isEventLocked(event)) {
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

    const requesterId = interaction.user.id;
    const acceptBtn = new ButtonBuilder()
      .setCustomId(`event:cohost-accept:${eventId}:${requesterId}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success);
    const denyBtn = new ButtonBuilder()
      .setCustomId(`event:cohost-deny:${eventId}:${requesterId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(acceptBtn, denyBtn);

    const channel = await interaction.client.channels.fetch(settings.eventPlanningChannelId).catch(() => null);
    if (!channel?.isTextBased() || channel.isDMBased()) {
      await interaction.followUp({
        content: "❌ Planning channel is not accessible or invalid.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reqMsg = await channel.send({
      content: `<@${requesterId}> requested to become co-host for **${event.title}**. <@${event.hostId}>, do you accept?`,
      components: [row],
      allowedMentions: { users: [event.hostId, requesterId] },
    });

    const claim = await prisma.plannedEvent.updateMany({
      where: { id: eventId, pendingCoHostUserId: null, coHostId: null },
      data: { pendingCoHostUserId: requesterId, coHostRequestMessageId: reqMsg.id },
    });
    if (claim.count === 0) {
      await reqMsg.delete().catch(() => null);
      await interaction.followUp({
        content: "❌ Another co-host request is already pending.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const refreshed = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (refreshed) {
      await updatePlanningChannelMessage(interaction.guild, refreshed);
    }
  }

  @ButtonComponent({ id: EVENT_RESUBMIT_PATTERN })
  async handleResubmitLegacy(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_RESUBMIT_PATTERN);
    if (!match) return;
    return this.runEdit(interaction, parseInt(match[1], 10));
  }

  @ButtonComponent({ id: EVENT_EDIT_PATTERN })
  async handleEdit(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_EDIT_PATTERN);
    if (!match) return;
    return this.runEdit(interaction, parseInt(match[1], 10));
  }

  private async runEdit(interaction: ButtonInteraction, eventId: number): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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

  @ButtonComponent({ id: EVENT_CANCEL_PATTERN })
  async handleCancel(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_CANCEL_PATTERN);
    if (!match) return;
    return this.runCancel(interaction, parseInt(match[1], 10));
  }

  @ButtonComponent({ id: EVENT_CANCEL_APPROVED_PATTERN })
  async handleCancelApprovedLegacy(interaction: ButtonInteraction): Promise<void> {
    const match = matchComponentId(interaction.customId, EVENT_CANCEL_APPROVED_PATTERN);
    if (!match) return;
    return this.runCancel(interaction, parseInt(match[1], 10));
  }

  private async runCancel(interaction: ButtonInteraction, eventId: number): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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
}
