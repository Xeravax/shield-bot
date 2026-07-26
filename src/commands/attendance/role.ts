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
@Guard(PermissionNodeGuard("attendance.command.role"))
export class VRChatAttendanceRoleCommand {
  @Slash({
    name: "role",
    description: "Manage member roles (lead/staff/cohost/unlead)",
  })
  async role(
    @SlashOption({
      name: "user",
      description: "Discord User",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "set_lead",
      description: "Mark user as squad lead",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    setLead: boolean | null,
    @SlashOption({
      name: "unlead",
      description: "Remove lead status from user",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    unlead: boolean | null,
    @SlashOption({
      name: "set_staff",
      description: "Add user as staff",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    setStaff: boolean | null,
    @SlashOption({
      name: "set_cohost",
      description: "Set user as cohost",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    setCohost: boolean | null,
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

    if (setLead) {
      await attendanceManager.markUserAsLead(eventId, dbUser.id);
      actions.push("lead");
    }

    if (unlead) {
      const member = await prisma.squadMember.findFirst({
        where: { squad: { eventId }, userId: dbUser.id, isLead: true },
      });

      if (!member) {
        await interaction.reply({
          content: `<@${user.id}> is not marked as a lead.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await prisma.squadMember.update({
        where: { id: member.id },
        data: { isLead: false },
      });
      actions.push("unlead");
    }

    if (setStaff) {
      await attendanceManager.addStaff(eventId, dbUser.id);
      actions.push("staff");
    }

    if (setCohost) {
      await attendanceManager.setCohost(eventId, dbUser.id);
      actions.push("cohost");
    }

    if (actions.length === 0) {
      await interaction.reply({
        content: "Please specify at least one role action (set_lead, unlead, set_staff, or set_cohost).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: `Updated roles for <@${user.id}>: ${actions.join(", ")}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

