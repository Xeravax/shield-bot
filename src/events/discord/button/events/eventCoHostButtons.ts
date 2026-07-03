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

@Discord()
export class EventCoHostButtonHandlers {
  @ButtonComponent({ id: /^event:cohost-accept:(\d+):(\d+)$/ })
  async handleCoHostAccept(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const parts = interaction.customId.split(":");
    const eventId = parseInt(parts[2], 10);
    const requesterId = parts[3];

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

    const updated = await prisma.plannedEvent.update({
      where: { id: eventId },
      data: {
        coHostId: requesterId,
        pendingCoHostUserId: null,
        coHostOpen: false,
        coHostRequestMessageId: null,
      },
    });

    await updatePlanningChannelMessage(interaction.guild, updated);

    await interaction.message.edit({
      content: `✅ <@${requesterId}> accepted as co-host for **${event.title}**.`,
      components: [],
    });
  }

  @ButtonComponent({ id: /^event:cohost-deny:(\d+):(\d+)$/ })
  async handleCoHostDeny(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: "❌ This can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const parts = interaction.customId.split(":");
    const eventId = parseInt(parts[2], 10);
    const requesterId = parts[3];

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

    const updated = await prisma.plannedEvent.update({
      where: { id: eventId },
      data: {
        pendingCoHostUserId: null,
        coHostRequestMessageId: null,
      },
    });

    await updatePlanningChannelMessage(interaction.guild, updated);

    await interaction.message.edit({
      content: `❌ Co-host request from <@${requesterId}> was denied for **${event.title}**.`,
      components: [],
    });
  }
}
