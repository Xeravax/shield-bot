import { prisma } from "../../main.js";
import { decrypt } from "../../utility/encryption.js";
import { getEnv } from "../../config/env.js";
import { loggers } from "../../utility/logger.js";
import { purgeCloudflareCache } from "../../utility/cloudflare/purgeCache.js";

/**
 * GitHub publishing operations for whitelist
 */
export class GitHubPublisher {
  /**
   * Get GitHub settings for a guild, falling back to environment variables
   */
  private async getGitHubSettings(guildId?: string): Promise<{
    token: string;
    owner: string;
    repo: string;
    branch: string;
    encodedFilePath: string;
    decodedFilePath: string;
  }> {
    // Try to get settings from database if guildId is provided
    if (guildId) {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId },
      });

      if (
        settings?.whitelistGitHubToken &&
        settings?.whitelistGitHubOwner &&
        settings?.whitelistGitHubRepo
      ) {
        // Decrypt the token if it's encrypted
        const encryptionKey = getEnv().ENCRYPTION_KEY;
        let decryptedToken = settings.whitelistGitHubToken;
        if (encryptionKey) {
          try {
            decryptedToken = await decrypt(settings.whitelistGitHubToken, encryptionKey);
          } catch (error) {
            // If decryption fails, assume it's plaintext (backward compatibility)
            // Note: We'll log this but continue with the plaintext value
            // In production, you may want to handle this differently
            loggers.bot.warn("Failed to decrypt GitHub token, assuming plaintext", error);
          }
        }

        return {
          token: decryptedToken,
          owner: settings.whitelistGitHubOwner,
          repo: settings.whitelistGitHubRepo,
          branch: settings.whitelistGitHubBranch || "main",
          encodedFilePath: settings.whitelistGitHubEncodedPath || "whitelist.encoded.txt",
          decodedFilePath: settings.whitelistGitHubDecodedPath || "whitelist.txt",
        };
      }
    }

    // Fall back to environment variables
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;
    const branch = process.env.GITHUB_REPO_BRANCH || "main";
    const encodedFilePath =
      process.env.GITHUB_REPO_ENCODED_FILE_PATH || "whitelist.encoded.txt";
    const decodedFilePath =
      process.env.GITHUB_REPO_DECODED_FILE_PATH || "whitelist.txt";

    if (!token) {
      throw new Error("GITHUB_TOKEN not configured (neither in database nor environment)");
    }
    if (!owner) {
      throw new Error("GITHUB_REPO_OWNER not configured (neither in database nor environment)");
    }
    if (!repo) {
      throw new Error("GITHUB_REPO_NAME not configured (neither in database nor environment)");
    }

    return {
      token,
      owner,
      repo,
      branch,
      encodedFilePath,
      decodedFilePath,
    };
  }

  /**
   * Update a GitHub repository with BOTH encoded and decoded whitelist files in a single commit.
   * Uses the low-level Git data API per the provided guide.
   * Reads settings from database (if guildId provided) or falls back to environment variables.
   */
  async updateRepositoryWithWhitelist(
    encodedData: string,
    decodedData: string,
    commitMessage?: string,
    guildId?: string,
  ): Promise<{
    updated: boolean;
    commitSha?: string;
    paths?: string[];
    branch?: string;
  }> {
    const { token, owner, repo, branch, encodedFilePath, decodedFilePath } =
      await this.getGitHubSettings(guildId);

    const apiBase = `https://api.github.com`;

    const gh = async (path: string, init?: RequestInit) => {
      const res = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      } as RequestInit);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `GitHub API error ${res.status} ${res.statusText}: ${text}`,
        );
      }
      return res.json();
    };

    // Step 1: Get latest commit on branch
    const ref = await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`);
    const latestCommitSha = (ref as { object?: { sha?: string } })?.object?.sha;
    if (!latestCommitSha)
      {throw new Error("Failed to resolve latest commit sha");}

    // Step 2: Get base tree of that commit
    const latestCommit = await gh(
      `/repos/${owner}/${repo}/git/commits/${latestCommitSha}`,
    );
    const baseTreeSha = (latestCommit as { tree?: { sha?: string } })?.tree?.sha;
    if (!baseTreeSha) {throw new Error("Failed to resolve base tree sha");}

    // Step 3: Create blobs for both files
    const [encodedBlob, decodedBlob] = await Promise.all([
      gh(`/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: encodedData, encoding: "utf-8" }),
      }),
      gh(`/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: decodedData, encoding: "utf-8" }),
      }),
    ]);
    const encodedBlobSha = (encodedBlob as { sha?: string })?.sha;
    const decodedBlobSha = (decodedBlob as { sha?: string })?.sha;
    if (!encodedBlobSha || !decodedBlobSha)
      {throw new Error("Failed to create blobs for whitelist files");}

    // Step 4: Create a new tree with both updated files
    const newTree = await gh(`/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: [
          {
            path: encodedFilePath,
            mode: "100644",
            type: "blob",
            sha: encodedBlobSha,
          },
          {
            path: decodedFilePath,
            mode: "100644",
            type: "blob",
            sha: decodedBlobSha,
          },
        ],
      }),
    });
    const newTreeSha = (newTree as { sha?: string })?.sha;
    if (!newTreeSha) {throw new Error("Failed to create new tree");}

    // Step 5: Create a new commit
    const message =
      commitMessage?.trim() && commitMessage.length > 0
        ? commitMessage
        : `chore(whitelist): update encoded (${encodedFilePath}) and decoded (${decodedFilePath}) at ${new Date().toISOString()}`;

    // Optional author/committer identity
    const authorName = process.env.GIT_AUTHOR_NAME || undefined;
    const authorEmail = process.env.GIT_AUTHOR_EMAIL || undefined;
    const committerName = process.env.GIT_COMMITTER_NAME || authorName;
    const committerEmail = process.env.GIT_COMMITTER_EMAIL || authorEmail;
    const nowIso = new Date().toISOString();

    const author =
      authorName && authorEmail
        ? { name: authorName, email: authorEmail, date: nowIso }
        : undefined;
    const committer =
      committerName && committerEmail
        ? { name: committerName, email: committerEmail, date: nowIso }
        : undefined;

    const commitBody: {
      message: string;
      tree: string;
      parents: string[];
      author?: { name: string; email: string; date: string };
      committer?: { name: string; email: string; date: string };
    } = {
      message,
      tree: newTreeSha,
      parents: [latestCommitSha],
    };
    if (author) {
      commitBody.author = author;
    }
    if (committer) {
      commitBody.committer = committer;
    }

    const newCommit = await gh(`/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify(commitBody),
    });
    const newCommitSha = (newCommit as { sha?: string })?.sha;
    if (!newCommitSha) {throw new Error("Failed to create new commit");}

    // Step 6: Update branch reference
    await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommitSha, force: false }),
    });

    return {
      updated: true,
      commitSha: newCommitSha,
      paths: [encodedFilePath, decodedFilePath],
      branch,
    };
  }

  /**
   * Get VRChat usernames with a specific whitelist permission.
   */
  private async getUsernamesByPermission(
    permission: string,
    guildId: string,
  ): Promise<string[]> {
    try {
      const entries = await prisma.whitelistEntry.findMany({
        where: {
          guildId: guildId,
        },
        select: {
          user: {
            select: {
              vrchatAccounts: {
                where: {
                  accountType: {
                    in: ["MAIN", "ALT", "UNVERIFIED"],
                  },
                },
                select: {
                  vrchatUsername: true,
                  accountType: true,
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

      const usernames = new Set<string>();

      for (const entry of entries) {
        // Check if user has the requested permission
        let hasPermission = false;
        for (const assignment of entry.roleAssignments) {
          if (assignment.role.permissions) {
            const permissions = assignment.role.permissions
              .split(",")
              .map((p: string) => p.trim());
            if (permissions.includes(permission)) {
              hasPermission = true;
              break;
            }
          }
        }

        if (hasPermission && entry.user.vrchatAccounts && entry.user.vrchatAccounts.length > 0) {
          // Prefer MAIN account, then ALT, then UNVERIFIED
          const accountTypes = ["MAIN", "ALT", "UNVERIFIED"];
          let selectedAccount = null;
          for (const accountType of accountTypes) {
            selectedAccount = entry.user.vrchatAccounts.find(
              (acc) => acc.accountType === accountType,
            );
            if (selectedAccount) {
              break;
            }
          }
          // Fallback to first account if no match found
          if (!selectedAccount) {
            selectedAccount = entry.user.vrchatAccounts[0];
          }
          if (selectedAccount?.vrchatUsername) {
            usernames.add(selectedAccount.vrchatUsername);
          }
        }
      }

      return Array.from(usernames).sort();
    } catch (error) {
      console.error(`Error getting users by permission ${permission}:`, error);
      return [];
    }
  }

  /**
   * Get usernames for a rooftop tier, checking multiple permission aliases.
   */
  private async getRooftopTierUsernames(
    permissions: string[],
    guildId: string,
  ): Promise<string[]> {
    const usernames = new Set<string>();
    for (const permission of permissions) {
      const tierUsers = await this.getUsernamesByPermission(permission, guildId);
      for (const username of tierUsers) {
        usernames.add(username);
      }
    }
    return Array.from(usernames).sort();
  }

  /**
   * Build the combined VIPSystem role list JSON.
   * @see VIPSystem "Combined Role List URL" (Use Combined Endpoint)
   */
  private buildCombinedRoleListJson(guildId: string): Promise<string> {
    return Promise.all([
      this.getRooftopTierUsernames(
        ["rooftop_staffplus", "rooftop_bouncer"],
        guildId,
      ),
      this.getRooftopTierUsernames(["rooftop_staff"], guildId),
      this.getRooftopTierUsernames(["rooftop_vipplus"], guildId),
      this.getRooftopTierUsernames(["rooftop_vip"], guildId),
    ]).then(([staffplus, staff, vipplus, vip]) =>
      JSON.stringify({ staffplus, staff, vipplus, vip }, null, 1),
    );
  }

  /**
   * Generate all rooftop files content
   */
  async generateRooftopFiles(guildId: string): Promise<{
    announcement: string;
    permissionsJson: string;
    announcements: string;
    spinthebottle: string;
  }> {
    const [announcementUsernames, permissionsJson, announcements, spinthebottle] =
      await Promise.all([
        this.getUsernamesByPermission("rooftop_announce", guildId),
        this.buildCombinedRoleListJson(guildId),
        (async () => {
          try {
            const announcements = await prisma.announcement.findMany({
              orderBy: {
                createdAt: "asc",
              },
              select: {
                content: true,
              },
            });
            return announcements.map((announcement) => announcement.content).join("\n");
          } catch (error) {
            console.error("Error getting announcements:", error);
            return "";
          }
        })(),
        (async () => {
          try {
            const responses = await prisma.spinTheBottleResponse.findMany({
              orderBy: {
                createdAt: "asc",
              },
              select: {
                content: true,
              },
            });
            return responses.map((response) => response.content).join("\n");
          } catch (error) {
            console.error("Error getting spin the bottle responses:", error);
            return "";
          }
        })(),
      ]);

    return {
      announcement: announcementUsernames.join("\n"),
      permissionsJson,
      announcements,
      spinthebottle,
    };
  }

  /**
   * Update GitHub repository with all rooftop files in a single commit.
   * Reads settings from database (if guildId provided) or falls back to environment variables.
   */
  async updateRepositoryWithRooftopFiles(
    guildId: string,
    commitMessage?: string,
  ): Promise<{
    updated: boolean;
    commitSha?: string;
    paths?: string[];
    branch?: string;
  }> {
    const { token, owner, repo, branch } = await this.getGitHubSettings(guildId);

    const apiBase = `https://api.github.com`;

    const gh = async (path: string, init?: RequestInit) => {
      const res = await fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      } as RequestInit);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `GitHub API error ${res.status} ${res.statusText}: ${text}`,
        );
      }
      return res.json();
    };

    // Generate all rooftop file contents
    const files = await this.generateRooftopFiles(guildId);

    // Step 1: Get latest commit on branch
    const ref = await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`);
    const latestCommitSha = (ref as { object?: { sha?: string } })?.object?.sha;
    if (!latestCommitSha)
      {throw new Error("Failed to resolve latest commit sha");}

    // Step 2: Get base tree of that commit
    const latestCommit = await gh(
      `/repos/${owner}/${repo}/git/commits/${latestCommitSha}`,
    );
    const baseTreeSha = (latestCommit as { tree?: { sha?: string } })?.tree?.sha;
    if (!baseTreeSha) {throw new Error("Failed to resolve base tree sha");}

    // Step 3: Create blobs for all files
    const fileData = [
      { path: "rooftop/permissions.json", content: files.permissionsJson },
      { path: "rooftop/announcement.txt", content: files.announcement },
      { path: "rooftop/announcements.txt", content: files.announcements },
      { path: "rooftop/spinthebottle.txt", content: files.spinthebottle },
    ];

    const blobShas = await Promise.all(
      fileData.map((file) =>
        gh(`/repos/${owner}/${repo}/git/blobs`, {
          method: "POST",
          body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
        }).then((blob) => {
          const sha = (blob as { sha?: string })?.sha;
          if (!sha) {throw new Error(`Failed to create blob for ${file.path}`);}
          return { path: file.path, sha };
        }),
      ),
    );

    // Step 4: Create a new tree with all updated files
    const newTree = await gh(`/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: blobShas.map(({ path, sha }) => ({
          path,
          mode: "100644",
          type: "blob",
          sha,
        })),
      }),
    });
    const newTreeSha = (newTree as { sha?: string })?.sha;
    if (!newTreeSha) {throw new Error("Failed to create new tree");}

    // Step 5: Create a new commit
    const message =
      commitMessage?.trim() && commitMessage.length > 0
        ? commitMessage
        : `chore(rooftop): update rooftop files at ${new Date().toISOString()}`;

    // Optional author/committer identity
    const authorName = process.env.GIT_AUTHOR_NAME || undefined;
    const authorEmail = process.env.GIT_AUTHOR_EMAIL || undefined;
    const committerName = process.env.GIT_COMMITTER_NAME || authorName;
    const committerEmail = process.env.GIT_COMMITTER_EMAIL || authorEmail;
    const nowIso = new Date().toISOString();

    const author =
      authorName && authorEmail
        ? { name: authorName, email: authorEmail, date: nowIso }
        : undefined;
    const committer =
      committerName && committerEmail
        ? { name: committerName, email: committerEmail, date: nowIso }
        : undefined;

    const commitBody: {
      message: string;
      tree: string;
      parents: string[];
      author?: { name: string; email: string; date: string };
      committer?: { name: string; email: string; date: string };
    } = {
      message,
      tree: newTreeSha,
      parents: [latestCommitSha],
    };
    if (author) {
      commitBody.author = author;
    }
    if (committer) {
      commitBody.committer = committer;
    }

    const newCommit = await gh(`/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify(commitBody),
    });
    const newCommitSha = (newCommit as { sha?: string })?.sha;
    if (!newCommitSha) {throw new Error("Failed to create new commit");}

    // Step 6: Update branch reference
    await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommitSha, force: false }),
    });

    const zoneId = process.env.CLOUDFLARE_ZONE_ID ?? "";
    const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
    if (zoneId && apiToken) {
      try {
        await purgeCloudflareCache(zoneId, apiToken, [
          `https://api.vrcshield.com/api/vrchat/${guildId}/rooftop/permissions`,
        ]);
        loggers.bot.info(`Purged Cloudflare cache for rooftop permissions (guild ${guildId})`);
      } catch (err) {
        loggers.bot.warn("Cloudflare purge failed for rooftop permissions", err);
      }
    }

    return {
      updated: true,
      commitSha: newCommitSha,
      paths: fileData.map((f) => f.path),
      branch,
    };
  }
}

