import { getUserById } from "../../utility/vrchat.js";
import { prisma } from "../../main.js";
import { loggers } from "../../utility/logger.js";
import { decrypt } from "../../utility/encryption.js";
import { getEnv } from "../../config/env.js";

/**
 * Whitelist content generation and encoding
 */
export class WhitelistGeneration {
  /**
   * Get all users in the whitelist, filtered by guild
   * Optimized to reduce N+1 queries by batching username updates
   */
  async getWhitelistUsers(guildId: string): Promise<unknown[]> {
    // Use select to only fetch needed fields, and filter entries by guildId
    const entries = await prisma.whitelistEntry.findMany({
      where: {
        guildId: guildId,
      },
      select: {
        createdAt: true,
        user: {
          select: {
            discordId: true,
            vrchatAccounts: {
              where: {
                accountType: {
                  in: ["MAIN", "ALT"],
                },
              },
              select: {
                id: true,
                vrcUserId: true,
                vrchatUsername: true,
                accountType: true,
                usernameUpdatedAt: true,
              },
            },
          },
        },
        roleAssignments: {
          where: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            role: {
              guildId: guildId,
            },
          },
          select: {
            role: {
              select: {
                permissions: true,
              },
            },
          },
        },
      },
    });

    const usersWithCurrentNames: unknown[] = [];
    const accountsNeedingUpdate: Array<{ id: number; vrcUserId: string }> = [];

    // First pass: collect data and identify accounts needing username updates
    for (const entry of entries) {
      const validAccounts = entry.user.vrchatAccounts || [];

      if (validAccounts.length === 0) {
        continue; // Skip users without any valid VRChat accounts
      }

      // Get unique permissions from all roles (deduplicated)
      const allPermissions = new Set<string>();
      for (const assignment of entry.roleAssignments) {
        if (assignment.role.permissions) {
          // Split permissions by comma and add each one
          const permissions = assignment.role.permissions
            .split(",")
            .map((p: string) => p.trim());
          permissions.forEach((permission: string) => {
            if (permission) {allPermissions.add(permission);}
          });
        }
      }

      // Create an entry for each VRChat account
      for (const vrchatAccount of validAccounts) {
        // Check if we need to fetch username (no cache or cache is just the vrcUserId)
        if (
          !vrchatAccount.vrchatUsername ||
          vrchatAccount.vrchatUsername === vrchatAccount.vrcUserId
        ) {
          accountsNeedingUpdate.push({
            id: vrchatAccount.id,
            vrcUserId: vrchatAccount.vrcUserId,
          });
        }

        usersWithCurrentNames.push({
          discordId: entry.user.discordId,
          vrchatUsername: vrchatAccount.vrchatUsername || vrchatAccount.vrcUserId,
          roles: Array.from(allPermissions),
          roleNames: entry.roleAssignments.map(
            (assignment: { role: { permissions: unknown } }) => assignment.role.permissions,
          ),
          createdAt: entry.createdAt,
          accountType: vrchatAccount.accountType || "UNKNOWN",
          vrcUserId: vrchatAccount.vrcUserId,
        });
      }
    }

    // Batch update usernames to avoid N+1 queries
    if (accountsNeedingUpdate.length > 0) {
      const updatePromises = accountsNeedingUpdate.map(async (account) => {
        try {
          // getUserById will auto-correct if account.vrcUserId is actually a username
          const userInfo = await getUserById(account.vrcUserId);
          const userTyped = userInfo as { displayName?: string; username?: string } | null;
          const vrchatUsername =
            userTyped?.displayName ||
            userTyped?.username ||
            account.vrcUserId;

          // Refresh account data in case vrcUserId was updated by auto-correction
          const updatedAccount = await prisma.vRChatAccount.findUnique({
            where: { id: account.id },
            select: { vrcUserId: true },
          });
          
          const currentVrcUserId = updatedAccount?.vrcUserId || account.vrcUserId;

          // Update the cached username in the database
          if (vrchatUsername !== currentVrcUserId) {
            await prisma.vRChatAccount.update({
              where: { id: account.id },
              data: {
                vrchatUsername,
                usernameUpdatedAt: new Date(),
              },
            });

            // Update the username in the result array
            // Try both the original and potentially corrected vrcUserId
            const resultEntry = usersWithCurrentNames.find(
              (entry: unknown) => {
                const entryVrcUserId = (entry as { vrcUserId: string }).vrcUserId;
                return entryVrcUserId === account.vrcUserId || entryVrcUserId === currentVrcUserId;
              },
            );
            if (resultEntry) {
              (resultEntry as { vrchatUsername: string }).vrchatUsername =
                vrchatUsername;
              // Update vrcUserId in result if it was corrected
              if (currentVrcUserId !== account.vrcUserId) {
                (resultEntry as { vrcUserId: string }).vrcUserId = currentVrcUserId;
              }
            }
          }
        } catch (error) {
          // Log error but continue - we already have a fallback username
          const errorMessage = error instanceof Error ? error.message : String(error);
          loggers.bot.warn(
            `Failed to update username for vrcUserId "${account.vrcUserId}": ${errorMessage}`,
            error,
          );
        }
      });

      // Execute updates in parallel (with reasonable concurrency limit)
      // Process in batches of 10 to avoid overwhelming the API
      const batchSize = 10;
      for (let i = 0; i < updatePromises.length; i += batchSize) {
        const batch = updatePromises.slice(i, i + batchSize);
        await Promise.allSettled(batch);
      }
    }

    return usersWithCurrentNames;
  }

  /**
   * Generate raw whitelist content, filtered by guild
   */
  async generateWhitelistContent(guildId: string): Promise<string> {
    const users = await this.getWhitelistUsers(guildId);

    if (users.length === 0) {
      return "";
    }

    return users
      .map((user) => {
        const userEntry = user as { roles?: string[]; vrchatUsername?: string };
        const roles = (userEntry.roles || []).join(":"); // Use colon separator for roles
        return `${userEntry.vrchatUsername || ""},${roles}`; // Use comma separator between username and roles
      })
      .join("\n");
  }

  /**
   * Generate encoded whitelist for PowerShell consumption, filtered by guild
   */
  async generateEncodedWhitelist(guildId: string): Promise<string> {
    const content = await this.generateWhitelistContent(guildId);
    return await this.xorEncode(content, guildId);
  }

  /**
   * XOR encode the content using the configured key (matching PowerShell script)
   * Reads key from database (if guildId provided) or falls back to environment variable
   * @throws Error if no XOR key is configured
   */
  private async xorEncode(content: string, guildId?: string): Promise<string> {
    let xorKey: string | null = null;

    // Try to get key from database if guildId is provided
    if (guildId) {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
        select: { whitelistXorKey: true },
      });
      if (settings?.whitelistXorKey) {
        // Decrypt the key if it's encrypted
        const encryptionKey = getEnv().ENCRYPTION_KEY;
        if (encryptionKey) {
          try {
            xorKey = await decrypt(settings.whitelistXorKey, encryptionKey);
          } catch (error) {
            // If decryption fails, assume it's plaintext (backward compatibility)
            loggers.bot.warn("Failed to decrypt XOR key, assuming plaintext", error);
            xorKey = settings.whitelistXorKey;
          }
        } else {
          xorKey = settings.whitelistXorKey;
        }
      }
    }

    // Fall back to environment variable
    if (!xorKey) {
      xorKey = process.env.WHITELIST_XOR_KEY || null;
    }

    // Fail-safe: throw error if no key is configured
    if (!xorKey) {
      const errorMessage = guildId
        ? `whitelist XOR key not configured for guild ${guildId} and WHITELIST_XOR_KEY environment variable is missing`
        : "WHITELIST_XOR_KEY environment variable is not set";
      loggers.bot.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Normalize line endings to LF only (\n), but KEEP them
    const normalizedContent = content.replace(/\r\n/g, "\n").trim();

    // Calculate checksum (over the UTF-8 bytes of the full text including newlines)
    const contentBytesForChecksum = Buffer.from(normalizedContent, "utf8");
    let checksum = 0;
    for (const byte of contentBytesForChecksum) {
      checksum += byte;
    }

    const contentWithChecksum = `${normalizedContent}|${checksum}`;

    // Convert to UTF-8 bytes
    const contentBytes = Buffer.from(contentWithChecksum, "utf8");
    const keyBytes = Buffer.from(xorKey, "utf8");

    if (keyBytes.length === 0) {
      throw new Error("XOR key cannot be empty");
    }

    // XOR encryption
    const xoredBytes = Buffer.alloc(contentBytes.length);
    for (let i = 0; i < contentBytes.length; i++) {
      xoredBytes[i] = contentBytes[i] ^ keyBytes[i % keyBytes.length];
    }

    // Base64 encode
    return xoredBytes.toString("base64");
  }
}

