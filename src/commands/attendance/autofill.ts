import { Discord, Slash, Guard, SlashGroup } from "discordx";
import {
  CommandInteraction,
  MessageFlags,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
} from "discord.js";
import { AttendanceManager } from "../../managers/attendance/attendanceManager.js";
import { AttendanceHostGuard } from "../../utility/guards.js";
import { prisma, loaManager } from "../../main.js";
import { isBlockingLOA } from "../../managers/loa/loaManager.js";
import {
  PermissionLevel,
  userHasSpecificRole,
} from "../../utility/permissionUtils.js";

const attendanceManager = new AttendanceManager();

@Discord()
@SlashGroup({
  name: "attendance",
  description: "VRChat attendance tracking commands.",
})
@SlashGroup("attendance")
@Guard(AttendanceHostGuard)
export class VRChatAttendanceAutofillCommand {
  @Slash({
    name: "autofill",
    description:
      "Auto-fill attendance based on voice channel presence in patrol category.",
  })
  async autofill(interaction: CommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) {
      await interaction.editReply({
        content: "This command can only be used in a server.",
      });
      return;
    }

    // Get guild settings
    if (!interaction.guildId) {
      await interaction.editReply({
        content: "This command can only be used in a server.",
      });
      return;
    }
    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: interaction.guildId },
    });

    if (!settings?.patrolChannelCategoryId) {
      await interaction.editReply({
        content:
          "Patrol category is not configured. Please configure it in the guild settings first.",
      });
      return;
    }

    const patrolCategoryId = settings.patrolChannelCategoryId;
    const enrolledChannels = (settings?.enrolledChannels as string[]) || [];

    if (enrolledChannels.length === 0) {
      await interaction.editReply({
        content:
          "No enrolled channels configured. Please configure enrolled channels in the guild settings first.",
      });
      return;
    }

    // Get all voice channels in the patrol category
    const guild = interaction.guild;
    const patrolCategory = guild.channels.cache.get(patrolCategoryId);

    if (!patrolCategory || patrolCategory.type !== ChannelType.GuildCategory) {
      await interaction.editReply({
        content:
          "Patrol category not found or is not a valid category channel.",
      });
      return;
    }

    // Get only enrolled voice channels in the category for squad tracking
    const voiceChannels = guild.channels.cache.filter(
      (channel) =>
        channel.parentId === patrolCategoryId &&
        channel.type === ChannelType.GuildVoice &&
        enrolledChannels.includes(channel.id),
    );

    if (voiceChannels.size === 0) {
      await interaction.editReply({
        content: "No enrolled voice channels found in the patrol category.",
      });
      return;
    }

    // Get ALL voice channels in ANY category for staff detection
    const allCategoryVoiceChannels = guild.channels.cache.filter(
      (channel) =>
        channel.type === ChannelType.GuildVoice &&
        channel.parentId && // Has a parent (is in a category)
        guild.channels.cache.get(channel.parentId)?.type === ChannelType.GuildCategory
    );

    // Check if user has an active event
    const user = await attendanceManager.findOrCreateUserByDiscordId(
      interaction.user.id,
    );
    let eventId = await attendanceManager.getActiveEventIdForUser(user.id);
    let event;

    // Create event if none exists
    if (!eventId) {
      event = await attendanceManager.createEvent(new Date(), user.id);
      eventId = event.id;
      await attendanceManager.setActiveEventForUser(user.id, eventId);
      // Reload to get relations
      event = await attendanceManager.getEventById(eventId);
    } else {
      event = await attendanceManager.getEventById(eventId);
    }

    if (!event) {
      await interaction.editReply({
        content: "Failed to get or create event.",
      });
      return;
    }

    // Check if host has staff role and add them as staff
    const hostMember = await guild.members.fetch(interaction.user.id);
    const isHostStaff = await userHasSpecificRole(hostMember, PermissionLevel.STAFF);
    if (isHostStaff) {
      await attendanceManager.addStaff(eventId, user.id);
    }

    // Check if this is the first autofill for this event
    const isFirstAutofill = !event.firstAutofillAt;
    
    // If this is the first autofill, record the timestamp
    if (isFirstAutofill) {
      await prisma.attendanceEvent.update({
        where: { id: eventId },
        data: { firstAutofillAt: new Date() },
      });
    }

    // Get current squad members to track changes
    const existingSquads = await prisma.squad.findMany({
      where: { eventId },
      include: {
        members: {
          include: { user: true },
        },
      },
    });

    // Create a map of current members and their squads
    const currentMemberSquads = new Map<string, string>(); // discordId -> squadChannelId
    for (const squad of existingSquads) {
      for (const member of squad.members) {
        if (!member.hasLeft) {
          currentMemberSquads.set(member.user.discordId, squad.name);
        }
      }
    }

    // Process voice channels and their members
    const processedUsers = new Set<string>();
    const newMemberSquads = new Map<string, string>(); // discordId -> squadChannelId
    let addedCount = 0;
    let splitCount = 0;
    let staffCount = 0;
    let lateCount = 0;
    let skippedBlockingLoaCount = 0;

    // First pass: Process all category channels for staff detection
    const staffMembersInCategories = new Set<string>();
    for (const channel of allCategoryVoiceChannels.values()) {
      if (channel.type !== ChannelType.GuildVoice) {continue;}

      const members = channel.members;
      for (const [memberId, member] of members) {
        const isStaff = await userHasSpecificRole(member, PermissionLevel.STAFF);
        if (isStaff) {
          staffMembersInCategories.add(memberId);
        }
      }
    }

    // Second pass: Process enrolled channels for squad tracking
    for (const [channelId, channel] of voiceChannels) {
      if (channel.type !== ChannelType.GuildVoice) {continue;}

      const members = channel.members;

      for (const memberId of members.keys()) {
        const activeLOA = await loaManager.getActiveLOA(interaction.guildId, memberId);
        if (isBlockingLOA(activeLOA)) {
          skippedBlockingLoaCount++;
          continue;
        }

        processedUsers.add(memberId);
        newMemberSquads.set(memberId, channelId);

        const dbUser = await attendanceManager.findOrCreateUserByDiscordId(
          memberId,
        );

        const previousSquad = currentMemberSquads.get(memberId);

        // Check if user has the specific STAFF role (not just dev with staff permissions)
        const isStaff = staffMembersInCategories.has(memberId);

        if (!previousSquad) {
          // New member - add them
          await attendanceManager.addUserToSquad(eventId, dbUser.id, channelId, interaction.guildId);
          addedCount++;

          // Mark as late if this is not the first autofill (they joined after initial roll call)
          if (!isFirstAutofill) {
            await attendanceManager.markUserAsLate(eventId, dbUser.id);
            lateCount++;
          }

          // Mark as staff if they have staff permissions
          if (isStaff) {
            await attendanceManager.addStaff(eventId, dbUser.id);
            staffCount++;
          }
        } else if (previousSquad !== channelId) {
          // Member split to a different squad
          await attendanceManager.markUserAsSplit(
            eventId,
            dbUser.id,
            channelId,
            previousSquad,
            interaction.guildId || undefined,
          );
          splitCount++;

          // Ensure staff status is maintained if applicable
          if (isStaff) {
            const existingStaff = await prisma.attendanceStaff.findFirst({
              where: { eventId, userId: dbUser.id },
            });
            if (!existingStaff) {
              await attendanceManager.addStaff(eventId, dbUser.id);
              staffCount++;
            }
          }
        } else {
          // Member is still in the same squad - ensure not marked as left
          const member = await prisma.squadMember.findFirst({
            where: { squad: { eventId, name: channelId }, userId: dbUser.id },
          });
          if (member?.hasLeft) {
            await prisma.squadMember.update({
              where: { id: member.id },
              data: { hasLeft: false },
            });
          }

          // Ensure staff status is current
          if (isStaff) {
            const existingStaff = await prisma.attendanceStaff.findFirst({
              where: { eventId, userId: dbUser.id },
            });
            if (!existingStaff) {
              await attendanceManager.addStaff(eventId, dbUser.id);
              staffCount++;
            }
          }
        }
      }
    }

    // Mark users who left as "hasLeft" - but exclude manually added users (host, cohost)
    let leftCount = 0;
    
    // Get list of users who should be exempt from auto-left tracking
    const exemptUserIds = new Set<string>();
    if (event.host?.discordId) {exemptUserIds.add(event.host.discordId);}
    if (event.cohost?.discordId) {exemptUserIds.add(event.cohost.discordId);}
    
    for (const discordId of currentMemberSquads.keys()) {
      // Skip marking as left if user is manually added (host/cohost)
      if (!processedUsers.has(discordId) && !exemptUserIds.has(discordId)) {
        const dbUser = await attendanceManager.findOrCreateUserByDiscordId(
          discordId,
        );
        await attendanceManager.markUserAsLeft(eventId, dbUser.id);
        leftCount++;
      }
    }

    const formatDate = event.date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const summary = [
      `**Attendance autofill complete for ${formatDate} (Event ID: ${eventId})**`,
      "",
      `✅ Added: ${addedCount} members`,
      `🔄 Split: ${splitCount} members`,
      `👤 Staff: ${staffCount} members marked as staff`,
      `⏰ Late: ${lateCount} members marked as late`,
      `🚫 Skipped (blocking LOA): ${skippedBlockingLoaCount} members`,
      `❌ Left: ${leftCount} members`,
      `📊 Total in event: ${processedUsers.size} members`,
      "",
      `**Use the select menus below to assign squad leads:**`,
    ].join("\n");

    // Get updated squads with members for lead selection
    const updatedSquads = await prisma.squad.findMany({
      where: { eventId },
      include: {
        members: {
          include: { user: true },
        },
      },
    });

    // Sort squads by Discord category position
    const sortedSquads = [...updatedSquads].sort((a, b) => {
      const channelA = interaction.guild?.channels.cache.get(a.name);
      const channelB = interaction.guild?.channels.cache.get(b.name);
      
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

    // Create select menus for each squad (max 5 per message due to Discord limits)
    const components: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
    const squadsWithMembers = sortedSquads.filter(
      (squad) => squad.members.length > 0 && !squad.members.every((m: { hasLeft: boolean }) => m.hasLeft)
    );

    for (const squad of squadsWithMembers.slice(0, 5)) {
      const squadChannel = interaction.guild?.channels.cache.get(squad.name);
      const squadDisplayName = squadChannel?.name || squad.name;

      // Get active members (not marked as left)
      const activeMembers = squad.members.filter((m: { hasLeft: boolean }) => !m.hasLeft);

      if (activeMembers.length === 0) {continue;}

      // Build options with Discord user mentions
      const options = await Promise.all(
        activeMembers.map(async (member: { userId: number; isLead: boolean; user: { discordId: string } }) => {
          let displayName = member.user.discordId;

          try {
            const guildMember = await interaction.guild?.members.fetch(
              member.user.discordId,
            );
            displayName =
              guildMember?.user.username ||
              guildMember?.displayName ||
              member.user.discordId;
          } catch {
            // If we can't fetch the user, use the Discord ID
            displayName = member.user.discordId;
          }

          return {
            label: displayName.substring(0, 100), // Discord limit
            value: `${squad.id}:${member.userId}`,
            description: member.isLead ? "Current Lead" : undefined,
            default: member.isLead,
          };
        }),
      );

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`autofill_lead_${eventId}_${squad.id}`)
        .setPlaceholder(`Select lead(s) for ${squadDisplayName}`)
        .setMinValues(0)
        .setMaxValues(Math.min(activeMembers.length, 25)) // Allow multiple leads
        .addOptions(options);

      const row =
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          selectMenu,
        );
      components.push(row);
    }

    const embed = new EmbedBuilder()
      .setTitle(`Attendance Autofill Complete`)
      .setDescription(summary)
      .setColor(0x00ae86)
      .setFooter({
        text: "Use the select menus below to assign squad leads",
      });

    await interaction.editReply({
      embeds: [embed],
      components: components.length > 0 ? components : undefined,
    });
  }
}
