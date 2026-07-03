import {
  ButtonInteraction,
  GuildMember,
  MessageFlags,
} from "discord.js";
import { Discord, ButtonComponent } from "discordx";
import { prisma } from "../../../../main.js";
import { memberIsFullHost, memberIsJrHostOnly } from "../../../../managers/events/eventRules.js";
import { updatePlanningChannelMessage } from "../../../../managers/events/eventPlanningManager.js";
import { hasNode } from "../../../../utility/permissionNodes.js";
import { matchComponentId } from "../../../../utility/componentId.js";

const EVENT_COHOST_ACCEPT_PATTERN = /^event:cohost-accept:(\d+):(\d+)$/;
const EVENT_COHOST_DENY_PATTERN = /^event:cohost-deny:(\d+):(\d+)$/;

@Discord()
export class EventCoHostButtonHandlers {
  @ButtonComponent({ id: EVENT_COHOST_ACCEPT_PATTERN })
  async handleCoHostAccept(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const match = matchComponentId(interaction.customId, EVENT_COHOST_ACCEPT_PATTERN);
    if (!match) return;

    const eventId = parseInt(match[1], 10);
    const requesterId = match[2];

    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.pendingCoHostUserId !== requesterId) {
      await interaction.reply({
        content: "❌ This co-host request is no longer valid.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = interaction.member as GuildMember;
    const canApprove =
      interaction.user.id === event.hostId ||
      (await hasNode(member, "events.manage.approve"));

    if (!canApprove) {
      await interaction.reply({
        content: "❌ Only the event host or staff can accept co-host requests.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const requesterMember = await interaction.guild.members
      .fetch(requesterId)
      .catch(() => null);

    const hostMember = await interaction.guild.members
      .fetch(event.hostId)
      .catch(() => null);

    if (hostMember && requesterMember) {
      const hostIsJrOnly = await memberIsJrHostOnly(hostMember);
      if (hostIsJrOnly && !(await memberIsFullHost(requesterMember))) {
        await interaction.reply({
          content: "❌ Jr. Host events require a full Host as co-host.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferUpdate();

    const claim = await prisma.plannedEvent.updateMany({
      where: { id: eventId, pendingCoHostUserId: requesterId },
      data: {
        coHostId: requesterId,
        pendingCoHostUserId: null,
        coHostOpen: false,
        coHostRequestMessageId: null,
      },
    });
    if (claim.count === 0) {
      await interaction.followUp({
        content: "❌ This co-host request was already processed.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updated = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (updated) {
      await updatePlanningChannelMessage(interaction.guild, updated);
    }

    await interaction.message.edit({
      content: `✅ <@${requesterId}> accepted as co-host for **${event.title}**.`,
      components: [],
    });
  }

  @ButtonComponent({ id: EVENT_COHOST_DENY_PATTERN })
  async handleCoHostDeny(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const match = matchComponentId(interaction.customId, EVENT_COHOST_DENY_PATTERN);
    if (!match) return;

    const eventId = parseInt(match[1], 10);
    const requesterId = match[2];

    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.pendingCoHostUserId !== requesterId) {
      await interaction.reply({
        content: "❌ This co-host request is no longer valid.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = interaction.member as GuildMember;
    const canDeny =
      interaction.user.id === event.hostId ||
      (await hasNode(member, "events.manage.approve"));

    if (!canDeny) {
      await interaction.reply({
        content: "❌ Only the event host or staff can deny co-host requests.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    const claim = await prisma.plannedEvent.updateMany({
      where: { id: eventId, pendingCoHostUserId: requesterId },
      data: {
        pendingCoHostUserId: null,
        coHostRequestMessageId: null,
      },
    });
    if (claim.count === 0) {
      await interaction.followUp({
        content: "❌ This co-host request was already processed.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updated = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (updated) {
      await updatePlanningChannelMessage(interaction.guild, updated);
    }

    await interaction.message.edit({
      content: `❌ Co-host request from <@${requesterId}> was denied for **${event.title}**.`,
      components: [],
    });
  }
}
