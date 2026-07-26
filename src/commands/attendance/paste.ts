import { Discord, Slash, SlashOption, Guard, SlashGroup } from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  MessageFlags,
  AutocompleteInteraction,
  BaseInteraction,
} from "discord.js";
import { AttendanceManager } from "../../managers/attendance/attendanceManager.js";
import { PermissionNodeGuard } from "../../utility/permissionNodes.js";

const attendanceManager = new AttendanceManager();

@Discord()
@SlashGroup({
  name: "attendance",
  description: "VRChat attendance tracking commands.",
})
@SlashGroup("attendance")
@Guard(PermissionNodeGuard("attendance.command.paste"))
export class VRChatAttendancePasteCommand {
  @Slash({
    name: "paste",
    description: "Generate copyable attendance text in standard format.",
  })
  async paste(
    @SlashOption({
      name: "event_id",
      description: "Specific event ID (defaults to active event)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      autocomplete: true,
    })
    eventId: number,
    interaction: BaseInteraction,
  ) {
    // Autocomplete handling
    if (interaction.isAutocomplete()) {
      const autoInteraction = interaction as AutocompleteInteraction;
      const focused = autoInteraction.options.getFocused(true);
      if (focused.name === "event_id") {
        // User lookup needed for event filtering
        void await attendanceManager.findOrCreateUserByDiscordId(
          autoInteraction.user.id,
        );
        const events = await attendanceManager.getAllEvents();
        const query = focused.value.toString().toLowerCase();
        const choices = events
          .filter((event: { id: number; date: Date; host?: { discordId: string | null } | null }) => {
            const idStr = `${event.id}`;
            const dateStr = event.date.toLocaleDateString();
            const hostId = event.host?.discordId || "";
            return (
              !query ||
              idStr.includes(query) ||
              dateStr.toLowerCase().includes(query) ||
              hostId.includes(query)
            );
          })
          .slice(0, 25)
          .map((event: { 
            id: number; 
            date: Date; 
            squads: Array<{ members: Array<{ userId: number }> }>; 
            staff: Array<{ userId: number }>; 
            host?: { discordId: string | null } | null 
          }) => {
            const dateStr = event.date.toLocaleDateString();
            const hostId = event.host?.discordId || "Unknown";
            
            // Calculate total attendees
            const squadMemberIds = new Set(
              event.squads.flatMap((squad: { members: Array<{ userId: number }> }) => 
                squad.members.map((member: { userId: number }) => member.userId)
              )
            );
            const staffIds = new Set(event.staff.map((s: { userId: number }) => s.userId));
            const allAttendeeIds = new Set([...squadMemberIds, ...staffIds]);
            const attendeeCount = allAttendeeIds.size;
            
            return {
              name: `${dateStr} (ID: ${event.id}) - ${attendeeCount} attendee${attendeeCount !== 1 ? 's' : ''} - Host: ${hostId}`.slice(
                0,
                100,
              ),
              value: event.id,
            };
          });
        await autoInteraction.respond(choices);
      }
      return;
    }

    const cmdInteraction = interaction as CommandInteraction;
    let targetEventId = eventId;

    if (!targetEventId) {
      const active =
        await attendanceManager.getActiveEventForInteraction(cmdInteraction);
      if (!active) {
        await cmdInteraction.reply({
          content:
            "No active attendance event found. Please specify an event ID or set an active event.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      targetEventId = active.eventId;
    }

    const eventSummary = await attendanceManager.getEventSummary(targetEventId);
    if (!eventSummary) {
      await cmdInteraction.reply({
        content: "Event not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const formatDate = eventSummary.date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    let text = `Attendance for ${formatDate}\n\n`;

    // Host and Co-Host
    text += `Host: ${eventSummary.host ? `<@${eventSummary.host.discordId}>` : "None"}\n`;
    text += `Co-Host: ${eventSummary.cohost ? `<@${eventSummary.cohost.discordId}>` : "None"}\n`;

    // Attending Staff
    if (eventSummary.staff.length > 0) {
      const staffList = eventSummary.staff
        .map((staff: { user: { discordId: string } }) => `<@${staff.user.discordId}>`)
        .join(" ");
      text += `Attending Staff: ${staffList}\n`;
    } else {
      text += `Attending Staff: None\n`;
    }

    text += "\n";

    // Sort squads by Discord category position
    const sortedSquads = [...eventSummary.squads].sort((a, b) => {
      const channelA = cmdInteraction.guild?.channels.cache.get(a.name);
      const channelB = cmdInteraction.guild?.channels.cache.get(b.name);
      
      // If both channels exist and have position property, sort by position
      if (channelA && channelB && 'position' in channelA && 'position' in channelB) {
        return channelA.position - channelB.position;
      }
      
      // If only one exists, put it first
      if (channelA) {return -1;}
      if (channelB) {return 1;}
      
      // If neither exists, maintain original order
      return 0;
    });

    // Squads
    for (const squad of sortedSquads) {
      const squadChannel = cmdInteraction.guild?.channels.cache.get(squad.name);
      const squadDisplayName = squadChannel?.name || squad.name;

      text += `${squadDisplayName}:\n`;

      if (squad.members.length === 0) {
        text += "*No members*\n\n";
        continue;
      }

      for (const member of squad.members) {
        let memberText = `<@${member.user.discordId}>`;

        const modifiers: string[] = [];
        if (member.isLead && !member.hasLeft) {modifiers.push("(Lead)");}
        if (member.isLate) {modifiers.push("(Late)");}
        if (member.isSplit && member.splitFrom) {
          // Try to get the channel name or mention from the splitFrom ID
          const splitFromChannel = cmdInteraction.guild?.channels.cache.get(member.splitFrom);
          const splitFromDisplay = splitFromChannel ? `<#${member.splitFrom}>` : member.splitFrom;
          modifiers.push(`(Split from ${splitFromDisplay})`);
        }

        if (member.hasLeft) {
          // For left users, show special formatting
          if (member.isLead) {
            modifiers.push("(~~Lead~~)");
          }
          modifiers.push("(Left)");

          // Check if they rejoined (not left anymore in current state)
          // This would need additional logic if you track rejoin history
        }

        if (modifiers.length > 0) {
          memberText += ` ${modifiers.join(" ")}`;
        }

        text += `${memberText}\n`;
      }

      text += "\n";
    }

    // Send the formatted text in a code block for easy copying
    await cmdInteraction.reply({
      content: `\`\`\`\n${text}\`\`\``,
      flags: MessageFlags.Ephemeral,
    });
  }
}
