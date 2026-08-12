import { prisma, bot, auditLogManager } from "../../../../main.js";
import { EmbedBuilder, Colors } from "discord.js";
import { getGroupMember, getGroupRoles } from "../../../../utility/vrchat/groups.js";
import { loggers } from "../../../../utility/logger.js";

interface GroupMemberUpdatedContent {
  userId?: string;
  groupId?: string;
}

export async function handleGroupMemberUpdated(content: unknown) {
  loggers.vrchat.debug("Group Member Updated event received", { content });
  const typedContent = content as GroupMemberUpdatedContent;

  // content should have userId (VRChat user ID) and groupId
  const vrcUserId = typedContent.userId;
  const groupId = typedContent.groupId;

  if (!vrcUserId) {
    loggers.vrchat.warn("No userId in event content - skipping");
    return;
  }

  loggers.vrchat.debug(`Processing update for VRChat user: ${vrcUserId}`);
  if (groupId) {
    loggers.vrchat.debug(`Group ID: ${groupId}`);
  } else {
    loggers.vrchat.debug(`No groupId in event content`);
  }

  // Find the verified VRChat account in our database
  const vrcAccount = await prisma.vRChatAccount.findFirst({
    where: {
      vrcUserId,
      accountType: { in: ["MAIN", "ALT"] },
    },
    include: { user: true },
  });

  if (!vrcAccount || !vrcAccount.user) {
    loggers.vrchat.debug(
      `No verified account found for VRChat user ${vrcUserId} - user not verified in bot database`,
    );
    return;
  }

  loggers.vrchat.debug(
    `Found verified account for ${vrcAccount.vrchatUsername || vrcUserId} (Discord: ${vrcAccount.user.discordId})`,
  );

  // Find all guilds with this VRChat group ID configured
  const guildSettings = await prisma.guildSettings.findMany({
    where: {
      vrcGroupId: groupId || { not: null },
    },
  });

  if (guildSettings.length === 0) {
    loggers.vrchat.debug(
      `No guilds found with VRChat group ${groupId || "any"} configured - no promotion logs channels to send to`,
    );
    return;
  }

  loggers.vrchat.debug(
    `Found ${guildSettings.length} guild(s) with this VRChat group configured`,
  );

  // Fetch current group member info and roles
  let groupMember: unknown = null;
  let allRoles: Array<{ id: string; name: string }> = [];
  let currentRoleNames: string[] = [];

  if (groupId) {
    try {
      loggers.vrchat.debug(`Fetching group member and roles info...`);
      groupMember = await getGroupMember(groupId, vrcUserId);
      allRoles = (await getGroupRoles(groupId)) as Array<{ id: string; name: string }>;

      // Map role IDs to names
      const roleMap = new Map(allRoles.map((r) => [r.id, r.name]));
      const memberTyped = groupMember as { roleIds?: string[]; mRoleIds?: string[] } | null;
      const memberRoleIds = [
        ...(memberTyped?.roleIds || []),
        ...(memberTyped?.mRoleIds || []),
      ];
      currentRoleNames = memberRoleIds
        .map((id) => roleMap.get(id))
        .filter((name) => name !== undefined);
      
      loggers.vrchat.debug(
        `Member has ${currentRoleNames.length} role(s): ${currentRoleNames.join(", ") || "none"}`,
      );
    } catch (error) {
      loggers.vrchat.error(
        "Error fetching role information",
        error,
      );
    }
  } else {
    loggers.vrchat.debug(
      "Skipping role fetch - no groupId available",
    );
  }

  const vrcUsername = vrcAccount.vrchatUsername || vrcUserId;
  const vrcUserLink = `[${vrcUsername}](https://vrchat.com/home/user/${vrcUserId})`;

  // Log to Bot Log (+ legacy promotion channel) for each configured guild
  for (const settings of guildSettings) {
    try {
      loggers.vrchat.debug(
        `Processing log for guild ${settings.guildId}...`,
      );
      
      const guild = await bot.guilds.fetch(settings.guildId).catch(() => null);
      if (!guild) {
        loggers.vrchat.warn(
          `Guild ${settings.guildId} not found or bot not in guild - skipping`,
        );
        continue;
      }

      const member = await guild.members
        .fetch(vrcAccount.user.discordId)
        .catch(() => null);
      
      if (!member) {
        loggers.vrchat.debug(
          `Discord member ${vrcAccount.user.discordId} not found in guild ${settings.guildId}`,
        );
      }

      const rolesText =
        currentRoleNames.length > 0
          ? currentRoleNames.map((name) => `• ${name}`).join("\n")
          : "_No roles assigned_";

      const embed = new EmbedBuilder()
        .setTitle("🔄 VRChat Group Roles Updated")
        .setDescription(
          `${member ? `<@${member.id}>` : vrcUsername}'s roles were updated in the VRChat group by a group admin.`,
        )
        .addFields(
          {
            name: "Discord Member",
            value: member ? `<@${member.id}>` : "_Not in server_",
            inline: true,
          },
          { name: "VRChat User", value: vrcUserLink, inline: true },
          {
            name: "Current VRChat Roles",
            value: rolesText,
            inline: false,
          },
          {
            name: "ℹ️ Note",
            value:
              "This change was made directly in VRChat by a group administrator. To keep Discord and VRChat roles in sync, use `/group role-sync` to update VRChat roles based on their Discord roles.",
            inline: false,
          },
        )
        .setColor(Colors.Gold)
        .setTimestamp()
        .setFooter({ text: "S.H.I.E.L.D. Bot - Group Role Sync" });

      await auditLogManager.fanOutWhitelistLog(
        settings.guildId,
        { embeds: [embed] },
        [settings.botPromotionLogsChannelId],
      );
      loggers.vrchat.info(
        `Successfully logged role update for ${vrcUsername} in guild ${settings.guildId}`,
      );
    } catch (error) {
      loggers.vrchat.error(
        `Error logging for guild ${settings.guildId}`,
        error,
      );
    }
  }
  
  loggers.vrchat.debug(
    `Completed processing for ${vrcUsername}`,
  );
}
