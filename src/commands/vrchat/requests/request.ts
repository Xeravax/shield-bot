import {
  Discord,
  Slash,
  SlashOption,
  SlashChoice,
  Guard,
  SlashGroup,
} from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  MessageFlags,
  AutocompleteInteraction,
  Client,
} from "discord.js";
import {
  getInstanceInfoByShortName,
  getUserById,
} from "../../../utility/vrchat.js";
import {
  VRChatLoginGuard,
  GuildGuard,
  PermissionNodeGuard,
  VerifiedAccountGuard,
} from "../../../utility/guards.js";
import {
  type AppGuardData,
  requireGuardVerifiedAccount,
} from "../../../utility/guardData.js";
import { loggers } from "../../../utility/logger.js";
import { prisma } from "../../../main.js";

@Discord()
@SlashGroup({
  name: "vrchat",
  description: "VRChat related commands.",
})
@SlashGroup("vrchat")
@Guard(VRChatLoginGuard)
export class VRChatRequestCommand {
  @Slash({
    name: "request",
    description: "Request backup or log dispatch for SHIELD.",
  })
  @Guard(
    GuildGuard,
    PermissionNodeGuard("vrchat.command.request"),
    VerifiedAccountGuard({ skipIfOption: "account" }),
  )
  async request(
    @SlashChoice({ name: "Backup Request", value: "backup" })
    @SlashChoice({ name: "Dispatch Log", value: "dispatch" })
    @SlashOption({
      name: "type",
      description: "Type of request",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    type: string,
    @SlashOption({
      name: "role",
      description:
        "What role to ping/request (searches available server roles)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    role: string,
    @SlashOption({
      name: "situation",
      description: "Current Situation. Hostage, Active Shooter, Etc",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    situation: string,
    @SlashOption({
      name: "squad",
      description: "Squad channel (searches enrolled squad channels)",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    squad: string,
    @SlashChoice({ name: "Active (🔴)", value: "active" })
    @SlashChoice({ name: "Resolved (🟢)", value: "resolved" })
    @SlashOption({
      name: "status",
      description: "Status",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    status: string,
    @SlashOption({
      name: "world",
      description: "World link (required for dispatch logs, optional for backup requests)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    world: string | null,
    @SlashOption({
      name: "account",
      description:
        "Account to use for this request (if not provided, will use the main verified account)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: true,
    })
    _account: string | null,
    interaction: CommandInteraction | AutocompleteInteraction,
    _client: Client,
    guardData: AppGuardData,
  ) {
    if (interaction.isAutocomplete()) {
      return this.autocompleteAccount(interaction);
    }

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch {
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "❌ Failed to start the request. Please try again.",
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => undefined);
      }
      return;
    }

    try {
      // Use role directly as roleId
      const roleId = role;

      // Use squad as the channel ID directly
      const channelId = squad;

      // Use status directly
      const incidentStatus = status;

      const vrcUserId = requireGuardVerifiedAccount(guardData).vrcUserId;

      // Get user info
      const vrcUser = await getUserById(vrcUserId);
      if (!vrcUser) {
        await interaction.editReply({
          content: "Could not find VRChat user information.",
        });
        return;
      }

      // Validate world is required for dispatch logs
      if (type === "dispatch" && !world) {
        await interaction.editReply({
          content:
            "World link is required for dispatch logs. Please provide a world link (vrch.at or vrc.group).",
        });
        return;
      }

      // Get world info if provided
      let worldInfo = "";
      if (world) {
        worldInfo = await this.resolveWorldFromLink(world);
      }

      // Create reply message based on type
      const roleMention = `<@&${roleId}>`;
      const requestType =
        roleId === "814239954641223760"
          ? "EMT"
          : roleId === "999860876062498827"
            ? "TRU"
            : "Backup";
      const squadText = `<#${channelId}>`;
      const statusText =
        incidentStatus === "active" ? "Active 🔴" : "Resolved 🟢";
      const situationText = situation || "[SITUATION NOT PROVIDED]";

      let replyMsg: string;
      if (type === "backup") {
        // Backup request format (with role mention at top)
        replyMsg = `\`\`\`
${roleMention}
**Request**: ${requestType}
**World**: ${world ? worldInfo : "[WORLD NOT PROVIDED]"}
**Situation**: ${situationText}
**Squad**: ${squadText}
**Status**: ${statusText}
\`\`\``;
      } else {
        // Dispatch log format
        replyMsg = `\`\`\`
World: ${world ? worldInfo : "[WORLD NOT PROVIDED]"}
Request: ${requestType}
Situation: ${situationText}
Squad: ${squadText}
Status: ${statusText}
\`\`\``;
      }

      // Ephemeral defer keeps error replies private; public follow-up matches prior reply behavior.
      let deletedEphemeral = false;
      try {
        await interaction.deleteReply();
        deletedEphemeral = true;
      } catch (deleteError) {
        loggers.vrchat.error(
          "Failed to delete ephemeral request reply before public follow-up",
          deleteError,
        );
        // Keep the ephemeral response as an ack; never put the public payload into editReply.
        await interaction
          .editReply({
            content: "✅ Request ready — posting publicly below.",
          })
          .catch(() => undefined);
      }

      try {
        await interaction.followUp({ content: replyMsg });
      } catch (followUpError) {
        loggers.vrchat.error(
          "Failed to post public request follow-up",
          followUpError,
        );
        if (!deletedEphemeral) {
          await interaction
            .editReply({
              content: "❌ Failed to post the request. Please try again.",
            })
            .catch(() => undefined);
        }
        // If the ephemeral reply was already deleted, there is no loading
        // state left to edit; the failure is logged above.
      }
    } catch (error: unknown) {
      loggers.vrchat.error("Error handling /vrchat request", error);
      await interaction
        .editReply({
          content: "❌ Failed to process the request. Please try again later.",
        })
        .catch(() => undefined);
    }
  }

  private async autocompleteAccount(interaction: AutocompleteInteraction) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === "role") {
      // Get available roles from the guild
      if (!interaction.guildId || !interaction.guild) {return;}
      const guild = interaction.guild;
      const choices = [];

      for (const [roleId, role] of guild.roles.cache) {
        if (role.name.toLowerCase().includes(focused.value.toLowerCase())) {
          choices.push({ name: role.name, value: roleId });
        }
      }

      await interaction.respond(choices.slice(0, 25));
      return;
    }

    if (focused.name === "squad") {
      // Use the same logic as attendance system for squad channels
      if (!interaction.guildId) {return;}
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });
      const enrolled = (settings?.enrolledChannels as string[]) || [];
      const guild = interaction.guild;
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
      await interaction.respond(choices.slice(0, 25));
      return;
    }

    if (focused.name === "account") {
      const user = await prisma.user.findUnique({
        where: { discordId: interaction.user.id },
        include: { vrchatAccounts: true },
      });

      if (!user || !user.vrchatAccounts) {
        return;
      }

      const choices = user.vrchatAccounts.map((acc: { vrchatUsername: string | null; vrcUserId: string; accountType: string }) => ({
        name: `${acc.vrchatUsername || acc.vrcUserId} (${acc.accountType})`,
        value: acc.vrcUserId,
      }));

      await interaction.respond(choices.slice(0, 25));
    }
  }

  private async resolveWorldFromLink(world: string): Promise<string> {
    // Check if it's a valid world link
    if (
      world.startsWith("https://vrc.group/") ||
      world.startsWith("https://vrch.at/")
    ) {
      const match = world.match(/(?:vrc\.group|vrch\.at)\/([^/?#]+)/);
      const shortName = match ? match[1] : null;
      if (shortName) {
        try {
          const instanceInfo = await getInstanceInfoByShortName(shortName);
          if (instanceInfo?.world?.name) {
            const worldName = instanceInfo.world.name;
            let instanceId = instanceInfo.instanceId || instanceInfo.id || "";
            if (typeof instanceId !== "string") {
              instanceId = String(instanceId);
            }
            
            // Extract instance number if it's a public instance
            const instanceMatch = instanceId.match(/^([0-9]+)~/);
            const instanceNumber = instanceMatch ? instanceMatch[1] : undefined;
            
            let worldNameWithInstance = worldName;
            if (instanceNumber) {
              worldNameWithInstance += ` (Instance #${instanceNumber})`;
            }
            
            // Build join link
            let joinLink = "";
            if (instanceId.includes("nonce") && instanceInfo.worldId) {
              joinLink = `https://vrchat.com/home/launch?worldId=${instanceInfo.worldId}&instanceId=${instanceId}`;
            } else if (
              instanceInfo.location &&
              typeof instanceInfo.location === "string" &&
              instanceInfo.location.includes("nonce") &&
              instanceInfo.worldId
            ) {
              joinLink = `https://vrchat.com/home/launch?worldId=${instanceInfo.worldId}&instanceId=${instanceInfo.location}`;
            } else if (instanceInfo.shortName) {
              joinLink = `https://vrch.at/${instanceInfo.shortName}`;
            } else if (instanceInfo.secureName) {
              joinLink = `https://vrch.at/${instanceInfo.secureName}`;
            } else {
              joinLink = world;
            }
            
            return `[${worldNameWithInstance}](${joinLink})`;
          }
        } catch (_) {
          // If we can't resolve the link, just return it as-is
          return world;
        }
      }
    }
    
    // If not a valid link format, return as-is
    return world;
  }
}

