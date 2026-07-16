import { Discord, Slash, SlashOption, Guard, SlashGroup, SlashChoice } from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  MessageFlags,
  AutocompleteInteraction,
  BaseInteraction,
  User,
} from "discord.js";
import { AttendanceManager } from "../../managers/attendance/attendanceManager.js";
import { AttendanceHostGuard } from "../../utility/guards.js";
import { prisma, loaManager } from "../../main.js";
import { isBlockingLOA } from "../../managers/loa/loaManager.js";

const attendanceManager = new AttendanceManager();

@Discord()
@SlashGroup({
  name: "attendance",
  description: "VRChat attendance tracking commands.",
})
@SlashGroup("attendance")
@Guard(AttendanceHostGuard)
export class VRChatAttendanceMemberCommand {
  @Slash({
    name: "member",
    description: "Manage squad members (add/remove/move/split)",
  })
  async member(
    @SlashChoice({ name: "Add", value: "add" })
    @SlashChoice({ name: "Remove", value: "remove" })
    @SlashChoice({ name: "Move", value: "move" })
    @SlashChoice({ name: "Split", value: "split" })
    @SlashOption({
      name: "action",
      description: "Action to perform",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    action: string,
    @SlashOption({
      name: "user",
      description: "Discord User",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "squad",
      description: "Squad channel (required for add/move/split)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: true,
    })
    squad: string | null,
    @SlashOption({
      name: "as_lead",
      description: "Mark as squad lead (for add)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    asLead: boolean | null,
    @SlashOption({
      name: "as_staff",
      description: "Mark as staff (for add)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    asStaff: boolean | null,
    @SlashOption({
      name: "as_late",
      description: "Mark as late (for add)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    asLate: boolean | null,
    interaction: BaseInteraction,
  ) {
    if (interaction.isAutocomplete()) {
      const autoInteraction = interaction as AutocompleteInteraction;
      const focused = autoInteraction.options.getFocused(true);
      if (focused.name === "squad") {
        if (!autoInteraction.guildId) {return;}
        const settings = await prisma.guildSettings.findUnique({
          where: { guildId: autoInteraction.guildId },
        });
        const enrolled = (settings?.enrolledChannels as string[]) || [];
        const guild = autoInteraction.guild;
        if (!guild) {return;}
        const choices = [];
        for (const channelId of enrolled) {
          const channel = guild.channels.cache.get(channelId);
          if (
            channel &&
            channel.name.toLowerCase().includes(focused.value.toLowerCase())
          ) {
            choices.push({ name: channel.name, value: channelId });
          }
        }
        await autoInteraction.respond(choices.slice(0, 25));
      }
      return;
    }

    const cmdInteraction = interaction as CommandInteraction;
    if (!cmdInteraction.guildId) {
      await cmdInteraction.reply({
        content: "❌ This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await cmdInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    const active =
      await attendanceManager.getActiveEventForInteraction(cmdInteraction);
    if (!active) {
      await cmdInteraction.editReply({
        content: "No active attendance event found.",
      });
      return;
    }

    const { eventId } = active;
    const dbUser = await attendanceManager.findOrCreateUserByDiscordId(user.id);
    const guildId = cmdInteraction.guildId;

    const blockingLOATargetActions = new Set(["add", "move", "split"]);
    if (blockingLOATargetActions.has(action)) {
      const activeLOA = await loaManager.getActiveLOA(guildId, user.id);
      if (isBlockingLOA(activeLOA)) {
        await cmdInteraction.editReply({
          content: `❌ <@${user.id}> has an active **blocking** leave of absence and cannot participate in event attendance.`,
        });
        return;
      }
    }

    // Handle remove action
    if (action === "remove") {
      await attendanceManager.forceRemoveUserFromEvent(eventId, dbUser.id);
      await cmdInteraction.editReply({
        content: `Completely removed <@${user.id}> from the event (no record kept)`,
      });
      return;
    }

    // All other actions require squad
    if (!squad) {
      await cmdInteraction.editReply({
        content: `Squad is required for ${action} action.`,
      });
      return;
    }

    const squadChannel = cmdInteraction.guild?.channels.cache.get(squad);
    const squadName = squadChannel?.name || squad;

    // Handle add action
    if (action === "add") {
      await attendanceManager.addUserToSquad(eventId, dbUser.id, squad, guildId);

      // Apply additional modifiers
      if (asLead) {
        await attendanceManager.markUserAsLead(eventId, dbUser.id);
      }

      if (asStaff) {
        await attendanceManager.addStaff(eventId, dbUser.id);
      }

      if (asLate) {
        await attendanceManager.markUserAsLate(eventId, dbUser.id);
      }

      const modifiers: string[] = [];
      if (asLead) {modifiers.push("Lead");}
      if (asStaff) {modifiers.push("Staff");}
      if (asLate) {modifiers.push("Late");}

      const modifierText =
        modifiers.length > 0 ? ` (${modifiers.join(", ")})` : "";

      await cmdInteraction.editReply({
        content: `Added <@${user.id}> to ${squadName}${modifierText}`,
      });
      return;
    }

    // Handle move action
    if (action === "move") {
      await attendanceManager.moveUserToSquad(eventId, dbUser.id, squad, guildId);
      await cmdInteraction.editReply({
        content: `Moved <@${user.id}> to ${squadName}`,
      });
      return;
    }

    // Handle split action
    if (action === "split") {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
        select: { aocChannelId: true },
      });
      const aocChannelId = settings?.aocChannelId ?? null;

      // Prefer retained AOC membership when present so markUserAsSplit is used
      const memberships = await prisma.squadMember.findMany({
        where: { userId: dbUser.id, squad: { eventId } },
        include: { squad: true },
        orderBy: { id: "asc" },
      });
      const currentMember =
        (aocChannelId
          ? memberships.find((m) => m.squad.name === aocChannelId)
          : undefined) ?? memberships[0] ?? null;

      const previousSquadChannelId = currentMember?.squad?.name || null;
      
      // Resolve previous squad channel name
      let previousSquadName = previousSquadChannelId;
      if (previousSquadChannelId) {
        const previousSquadChannel = cmdInteraction.guild?.channels.cache.get(previousSquadChannelId);
        previousSquadName = previousSquadChannel?.name || previousSquadChannelId;
      }

      // Use markUserAsSplit to handle AOC special case
      if (previousSquadChannelId) {
        await attendanceManager.markUserAsSplit(
          eventId,
          dbUser.id,
          squad,
          previousSquadChannelId,
          guildId,
        );
      } else {
        await attendanceManager.moveUserToSquad(eventId, dbUser.id, squad, guildId);
      }

      await cmdInteraction.editReply({
        content: `Split <@${user.id}> to ${squadName}${previousSquadName ? ` (Split from ${previousSquadName})` : ""}`,
      });
      return;
    }

    await cmdInteraction.editReply({
      content: "❌ Invalid action. Use 'add', 'remove', 'move', or 'split'.",
    });
  }
}
