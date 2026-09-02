import type { Context } from "koa";
import { GuildMember } from "discord.js";
import { getEnv } from "../../config/env.js";
import { bot } from "../../main.js";
import { loggers } from "../logger.js";

const DISCORD_API = "https://discord.com/api/v10";

export interface DiscordOAuthUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  discriminator: string;
}

type TokenCacheEntry = {
  user: DiscordOAuthUser;
  expiresAt: number;
};

const tokenCache = new Map<string, TokenCacheEntry>();
const TOKEN_CACHE_TTL_MS = 60_000;

export function bearerToken(ctx: Context): string | null {
  const header = ctx.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function exchangeOAuthCode(code: string): Promise<{
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}> {
  const env = getEnv();
  const clientId = env.APPLICATION_ID;
  const clientSecret = env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new DashboardConfigError(
      "Dashboard OAuth is not configured (APPLICATION_ID / DISCORD_CLIENT_SECRET).",
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
  });

  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    loggers.bot.warn("Dashboard OAuth token exchange failed", {
      status: res.status,
      body: text.slice(0, 500),
    });
    throw new DashboardAuthError("Invalid or expired authorization code.");
  }

  return (await res.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
  };
}

export async function fetchDiscordUser(
  accessToken: string,
): Promise<DiscordOAuthUser> {
  const cached = tokenCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new DashboardAuthError("Invalid or expired access token.");
  }

  const user = (await res.json()) as DiscordOAuthUser;
  tokenCache.set(accessToken, {
    user,
    expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
  });
  return user;
}

export function dashboardGuildId(): string {
  const guildId = getEnv().DASHBOARD_GUILD_ID;
  if (!guildId) {
    throw new DashboardConfigError("DASHBOARD_GUILD_ID is not configured.");
  }
  return guildId;
}

export async function resolveDashboardMember(
  accessToken: string,
): Promise<{ user: DiscordOAuthUser; member: GuildMember | null }> {
  const user = await fetchDiscordUser(accessToken);
  const guildId = dashboardGuildId();

  if (!bot.isReady()) {
    throw new DashboardConfigError("Bot is not ready.");
  }

  const guild = await bot.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    throw new DashboardConfigError(
      "Dashboard guild is unavailable (bot not in guild?).",
    );
  }

  const member = await guild.members.fetch(user.id).catch(() => null);
  return { user, member };
}

export function setDashboardCors(ctx: Context): void {
  const origin = ctx.headers.origin;
  if (origin) {
    ctx.set("Access-Control-Allow-Origin", origin);
    ctx.set("Access-Control-Allow-Credentials", "true");
  } else {
    ctx.set("Access-Control-Allow-Origin", "*");
  }
  ctx.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept",
  );
  ctx.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  ctx.set("Vary", "Origin");
}

export class DashboardAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardAuthError";
  }
}

export class DashboardConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardConfigError";
  }
}

export class DashboardForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardForbiddenError";
  }
}
