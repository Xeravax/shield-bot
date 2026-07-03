import { Discord, Slash, SlashOption, Guard, SlashGroup } from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  MessageFlags,
  User,
} from "discord.js";
import { AttendanceManager } from "../../managers/attendance/attendanceManager.js";
import { PermissionNodeGuard } from "../../utility/permissionNodes.js";
import { prisma } from "../../main.js";

const attendanceManager = new AttendanceManager();

@Discord()
@SlashGroup({
  name: "attendance",
  description: "VRChat attendance tracking commands.",
})
@SlashGroup("attendance")
@Guard(PermissionNodeGuard("attendance.command.status"))
export class VRChatAttendanceStatusCommand {
  @Slash({
    name: "status",
    description: "Manage member status (late/left/unleft)",
  })
  async status(
    @SlashOption({
      name: "user",
      description: "Discord User",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "mark_late",
      description: "Mark user as late",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    markLate: boolean | null,
    @SlashOption({
      name: "mark_left",
      description: "Mark user as having left",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    markLeft: boolean | null,
    @SlashOption({
      name: "unleft",
      description: "Mark user as having returned (undo left)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    unleft: boolean | null,
    interaction: CommandInteraction,
  ) {
    const active =
      await attendanceManager.getActiveEventForInteraction(interaction);
    if (!active) {
      await interaction.reply({
        content: "No active attendance event found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { eventId } = active;
    const dbUser = await attendanceManager.findOrCreateUserByDiscordId(user.id);

    const actions: string[] = [];

    if (markLate) {
      await attendanceManager.markUserAsLate(eventId, dbUser.id);
      actions.push("late");
    }

    if (markLeft) {
      await attendanceManager.markUserAsLeft(eventId, dbUser.id);
      actions.push("left");
    }

    if (unleft) {
      const member = await prisma.squadMember.findFirst({
        where: { squad: { eventId }, userId: dbUser.id, hasLeft: true },
      });

      if (!member) {
        await interaction.reply({
          content: `<@${user.id}> is not marked as having left the event.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.squadMember.update({
        where: { id: member.id },
        data: { hasLeft: false },
      });
      actions.push("returned");
    }

    if (actions.length === 0) {
      await interaction.reply({
        content: "Please specify at least one status action (mark_late, mark_left, or unleft).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: `Updated status for <@${user.id}>: ${actions.join(", ")}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

