import { TextDisplayBuilder, MessageFlags, Client, ContainerBuilder } from "discord.js";
import { prisma } from "../../main.js";
import { loggers } from "../logger.js";

export interface WhitelistLogData {
  discordId: string;
  displayName: string;
  vrchatUsername?: string;
  vrcUserId?: string;
  roles: string[];
  action: "verified" | "modified" | "removed";
  accountType?: "MAIN" | "ALT" | "UNVERIFIED" | "IN_VERIFICATION";
}

/**
 * Send a whitelist log message using componentsv2
 */
export async function sendWhitelistLog(
  client: Client,
  guildId: string,
  data: WhitelistLogData,
): Promise<void> {
  try {
    // Get the whitelist log channel from guild settings
    const guildSettings = await prisma.guildSettings.findUnique({
      where: { guildId },
      select: { whitelistLogChannelId: true },
    });

    if (!guildSettings?.whitelistLogChannelId) {
      loggers.bot.debug(
        `No whitelist log channel configured for guild ${guildId}`,
      );
      return;
    }

    // Fetch the log channel
    const channel = await client.channels.fetch(
      guildSettings.whitelistLogChannelId,
    );
    if (
      !channel ||
      !channel.isTextBased() ||
      !("send" in channel)
    ) {
      loggers.bot.warn(
        `Invalid log channel ${guildSettings.whitelistLogChannelId} for guild ${guildId}`,
      );
      return;
    }

    // Build the log message content
    const content = buildLogContent(data);

    // Create the text display component with the content
    const textDisplay = new TextDisplayBuilder()
      .setContent(content);

    // Create a container with yellow sidebar
    const container = new ContainerBuilder()
      .setAccentColor(0xffd700) // Yellow/gold color
      .addTextDisplayComponents([textDisplay]);

    // Send the message with componentsv2
    await channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });

    loggers.bot.info(
      `Logged ${data.action} action for ${data.displayName} in guild ${guildId}`,
    );
  } catch (error) {
    loggers.bot.error(
      `Failed to send whitelist log for guild ${guildId}`,
      error,
    );
  }
}

/**
 * Build the log message content based on the action
 */
function buildLogContent(data: WhitelistLogData): string {
  const userMention = `<@${data.discordId}>`;
  
  // Build VRChat account display with link
  let vrchatDisplay = data.vrchatUsername || "Unknown VRChat user";
  if (data.vrcUserId) {
    const vrcLink = `https://vrchat.com/home/user/${encodeURIComponent(data.vrcUserId)}`;
    vrchatDisplay = `[${vrchatDisplay}](${vrcLink})`;
  }

  // Add account type badge if provided
  if (data.accountType) {
    const badge = getAccountTypeBadge(data.accountType);
    vrchatDisplay = `${vrchatDisplay} ${badge}`;
  }

  // Build roles list
  const rolesDisplay = data.roles.length
    ? data.roles.map((role) => `\`${escapeMarkdown(role)}\``).join(", ")
    : "none";

  // Build message based on action
  switch (data.action) {
    case "verified":
      return `${userMention} - Verified with ${vrchatDisplay} and obtained ${rolesDisplay}.`;
    case "modified":
      return `${userMention} - Whitelist modified for ${vrchatDisplay} with roles ${rolesDisplay}.`;
    case "removed":
      return `${userMention} - Whitelist access removed for ${vrchatDisplay} (had roles: ${rolesDisplay}).`;
    default:
      return `${userMention} - Whitelist action for ${vrchatDisplay}: ${rolesDisplay}`;
  }
}

/**
 * Get a badge/emoji for the account type
 */
function getAccountTypeBadge(accountType: string): string {
  switch (accountType) {
    case "MAIN":
      return "**[MAIN <:HappyExite:923018075073302579>]**";
    case "ALT":
      return "**[ALT <:Elixir:1357029222115446844>]**";
    case "UNVERIFIED":
      return "**[UNVERIFIED <a:homerdisapear:1324348827372621845>]**";
    case "IN_VERIFICATION":
      return "**[IN VERIFICATION <a:loading:867923149465980929>]**";
    default:
      return "";
  }
}

/**
 * Escape markdown special characters
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_`~|])/g, "\\$1");
}

/**
 * Get user's whitelist roles from database for a specific guild
 */
export async function getUserWhitelistRoles(
  discordId: string,
  guildId: string,
): Promise<string[]> {
  try {
    const user = await prisma.user.findUnique({
      where: { discordId },
      include: {
        whitelistEntries: {
          where: { guildId },
          include: {
            roleAssignments: {
              where: {
                role: {
                  guildId: guildId,
                },
              },
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    // Extract VRChat roles from permissions field (comma-separated)
    const roles = new Set<string>();
    for (const entry of user?.whitelistEntries || []) {
      for (const assignment of entry.roleAssignments || []) {
        if (assignment.role.permissions) {
          for (const role of String(assignment.role.permissions)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)) {
            roles.add(role);
          }
        }
      }
    }
    return Array.from(roles).sort();
  } catch (error) {
    loggers.bot.error(
      `Failed to get whitelist roles for ${discordId} in guild ${guildId}`,
      error,
    );
    return [];
  }
}

/**
 * Get VRChat account info for a Discord user
 */
export async function getVRChatAccountInfo(discordId: string): Promise<{
  vrchatUsername?: string;
  vrcUserId?: string;
} | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { discordId },
      include: {
        vrchatAccounts: {
          where: {
            accountType: {
              in: ["MAIN", "ALT"],
            },
          },
          orderBy: {
            accountType: "asc", // MAIN comes before ALT
          },
          take: 1,
        },
      },
    });

    const account = user?.vrchatAccounts?.[0];
    if (!account) {return null;}

    return {
      vrchatUsername: account.vrchatUsername || undefined,
      vrcUserId: account.vrcUserId,
    };
  } catch (error) {
    loggers.bot.error(
      `Failed to get VRChat account info for ${discordId}`,
      error,
    );
    return null;
  }
}
