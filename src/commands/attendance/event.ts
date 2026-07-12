import { Discord, Slash, SlashOption, SlashGroup, SlashChoice, Guard } from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  MessageFlags,
  AutocompleteInteraction,
  BaseInteraction,
  User,
  EmbedBuilder,
} from "discord.js";
import { Pagination } from "@discordx/pagination";
import { AttendanceManager } from "../../managers/attendance/attendanceManager.js";
import { GuildGuard } from "../../utility/guards.js";
import { PermissionNodeGuard } from "../../utility/permissionNodes.js";

const attendanceManager = new AttendanceManager();

@Discord()
@SlashGroup({
  name: "attendance",
  description: "VRChat attendance tracking commands.",
})
@SlashGroup("attendance")
export class VRChatAttendanceEventCommand {
  @Slash({
    name: "event",
    description: "Manage attendance events (create/list/select/delete)",
  })
  @Guard(GuildGuard, PermissionNodeGuard("attendance.command.event"))
  async event(
    @SlashChoice({ name: "Create", value: "create" })
    @SlashChoice({ name: "List", value: "list" })
    @SlashChoice({ name: "Select", value: "select" })
    @SlashChoice({ name: "Delete", value: "delete" })
    @SlashOption({
      name: "action",
      description: "Action to perform",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    action: string,
    @SlashOption({
      name: "date",
      description: "Event date (YYYY-MM-DD) or 'today' (for create)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    dateInput: string | null,
    @SlashOption({
      name: "host",
      description: "Event host (for create, defaults to you)",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    host: User | null,
    @SlashOption({
      name: "cohost",
      description: "Event co-host (for create)",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    cohost: User | null,
    @SlashOption({
      name: "event",
      description: "Event ID (for select/delete)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      autocomplete: true,
    })
    eventId: number | null,
    @SlashOption({
      name: "confirm",
      description: "Type 'yes' to confirm deletion (for delete)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    confirm: string | null,
    interaction: BaseInteraction,
  ) {
    // Handle autocomplete for event ID
    if (interaction.isAutocomplete()) {
      const autoInteraction = interaction as AutocompleteInteraction;
      const focused = autoInteraction.options.getFocused(true);

      if (focused.name === "event") {
        void await attendanceManager.findOrCreateUserByDiscordId(
          autoInteraction.user.id,
        );
        const events = await attendanceManager.getAllEvents();

        const choices = await Promise.all(
          events
            .filter((event: { id: number; date: Date }) => {
              const eventStr = `${event.id}`;
              const dateStr = event.date.toLocaleDateString();
              return (
                eventStr.includes(focused.value.toString()) ||
                dateStr.includes(focused.value.toString())
              );
            })
            .slice(0, 25)
            .map(async (event: { 
              id: number; 
              date: Date; 
              squads: Array<{ members: Array<{ userId: number }> }>; 
              staff: Array<{ userId: number }>; 
              host?: { discordId: string | null } | null 
            }) => {
              const squadMemberIds = new Set(
                event.squads.flatMap((squad: { members: Array<{ userId: number }> }) => 
                  squad.members.map((member: { userId: number }) => member.userId)
                )
              );
              const staffIds = new Set(event.staff.map((s: { userId: number }) => s.userId));
              const allAttendeeIds = new Set([...squadMemberIds, ...staffIds]);
              const attendeeCount = allAttendeeIds.size;

              // Use cached member if available, otherwise just use ID (don't fetch to avoid rate limits)
              let hostName = "Unknown";
              if (event.host?.discordId) {
                const cachedMember = autoInteraction.guild?.members.cache.get(event.host.discordId);
                if (cachedMember) {
                  hostName = cachedMember.user.username || cachedMember.user.tag || event.host.discordId;
                } else {
                  // Don't fetch - just use ID to avoid rate limits in autocomplete
                  hostName = `User ${event.host.discordId.slice(0, 8)}...`;
                }
              }

              return {
                name: `${event.date.toLocaleDateString()} (ID: ${event.id}) - ${attendeeCount} attendee${attendeeCount !== 1 ? 's' : ''} - Host: ${hostName}`,
                value: event.id,
              };
            })
        );

        await autoInteraction.respond(choices);
      }
      return;
    }

    const cmdInteraction = interaction as CommandInteraction;

    // Handle list action
    if (action === "list") {
      const user = await attendanceManager.findOrCreateUserByDiscordId(
        cmdInteraction.user.id,
      );
      const events = await attendanceManager.getAllEvents();

      if (events.length === 0) {
        await cmdInteraction.reply({
          content: "There are no attendance events.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const activeEventId = await attendanceManager.getActiveEventIdForUser(
        user.id,
      );

      const eventsPerPage = 5;
      const pages = [];
      
      for (let i = 0; i < events.length; i += eventsPerPage) {
        const pageEvents = events.slice(i, i + eventsPerPage);
        let description = "";
        
        for (const event of pageEvents) {
          const formatDate = event.date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          });

          const squadMemberIds = new Set(
            event.squads.flatMap((squad: { members: Array<{ userId: number }> }) => 
              squad.members.map((member: { userId: number }) => member.userId)
            )
          );
          const staffIds = new Set(event.staff.map((s: { userId: number }) => s.userId));
          const allAttendeeIds = new Set([...squadMemberIds, ...staffIds]);
          const attendeeCount = allAttendeeIds.size;

          const isActive = event.id === activeEventId ? " **(ACTIVE)**" : "";
          const isHost = event.hostId === user.id ? " 👑" : "";
          const isCohost = event.cohostId === user.id ? " 🤝" : "";
          
          let hostName = "Unknown";
          if (event.host?.discordId) {
            try {
              const hostUser = await cmdInteraction.guild?.members.fetch(event.host.discordId);
              hostName = hostUser?.user.username || hostUser?.user.tag || event.host.discordId;
            } catch {
              hostName = event.host.discordId;
            }
          }

          description += `**${formatDate}** (ID: ${event.id})${isActive}${isHost}${isCohost}\n`;
          description += `  Host: ${hostName} | Attendees: ${attendeeCount}\n\n`;
        }

        const embed = new EmbedBuilder()
          .setTitle("Attendance Events")
          .setDescription(description)
          .setColor(0x00ae86)
          .setFooter({
            text: `Page ${pages.length + 1} of ${Math.ceil(events.length / eventsPerPage)} | Use /attendance event select <event_id> to switch active event`,
          });

        pages.push({ embeds: [embed] });
      }

      const pagination = new Pagination(cmdInteraction, pages, {
        ephemeral: true,
        time: 5 * 60 * 1000,
      });

      await pagination.send();
      return;
    }

    // Handle select action
    if (action === "select") {
      if (!eventId) {
        await cmdInteraction.reply({
          content: "Event ID is required for select action.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const user = await attendanceManager.findOrCreateUserByDiscordId(
        cmdInteraction.user.id,
      );

      const event = await attendanceManager.getEventById(eventId);
      if (!event) {
        await cmdInteraction.reply({
          content: "Event not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await attendanceManager.setActiveEventForUser(user.id, eventId);

      const formatDate = event.date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      await cmdInteraction.reply({
        content: `Selected event for ${formatDate} (ID: ${eventId}) as your active event.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Handle delete action
    if (action === "delete") {
      if (!eventId) {
        await cmdInteraction.reply({
          content: "Event ID is required for delete action.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!confirm || confirm.toLowerCase() !== "yes") {
        await cmdInteraction.reply({
          content: "Deletion cancelled. You must type 'yes' to confirm.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const user = await attendanceManager.findOrCreateUserByDiscordId(
        cmdInteraction.user.id,
      );

      const event = await attendanceManager.getEventById(eventId);
      if (!event) {
        await cmdInteraction.reply({
          content: "Event not found.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (event.hostId !== user.id) {
        await cmdInteraction.reply({
          content: "Only the event host can delete this event.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const activeEventId = await attendanceManager.getActiveEventIdForUser(
        user.id,
      );
      if (activeEventId === eventId) {
        await attendanceManager.clearActiveEventForUser(user.id);
      }

      await attendanceManager.deleteEventData(eventId);

      const formatDate = event.date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      await cmdInteraction.reply({
        content: `Successfully deleted attendance event for ${formatDate} (ID: ${eventId}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Handle create action
    if (action === "create") {
      let eventDate: Date;

      if (!dateInput || dateInput.toLowerCase() === "today") {
        eventDate = new Date();
      } else {
        try {
          eventDate = new Date(dateInput);
          if (isNaN(eventDate.getTime())) {
            await cmdInteraction.reply({
              content: "Invalid date format. Please use YYYY-MM-DD or 'today'.",
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
        } catch {
          await cmdInteraction.reply({
            content: "Invalid date format. Please use YYYY-MM-DD or 'today'.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      const hostUser = host || cmdInteraction.user;
      const cohostUser = cohost;

      const dbHost = await attendanceManager.findOrCreateUserByDiscordId(
        hostUser.id,
      );
      const dbCohost = cohostUser
        ? await attendanceManager.findOrCreateUserByDiscordId(cohostUser.id)
        : undefined;

      const event = await attendanceManager.createEvent(
        eventDate,
        dbHost.id,
        dbCohost?.id,
      );

      const creator = await attendanceManager.findOrCreateUserByDiscordId(
        cmdInteraction.user.id,
      );
      await attendanceManager.setActiveEventForUser(creator.id, event.id);

      const formatDate = eventDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      await cmdInteraction.reply({
        content:
          `Created attendance event for ${formatDate}\n` +
          `Host: <@${hostUser.id}>\n` +
          `${cohostUser ? `Co-Host: <@${cohostUser.id}>\n` : ""}` +
          `Event ID: ${event.id}\n\n` +
          `This event is now your active event. Use other attendance commands to manage it.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await cmdInteraction.reply({
      content: "❌ Invalid action. Use 'create', 'list', 'select', or 'delete'.",
      flags: MessageFlags.Ephemeral,
    });
  }
}

