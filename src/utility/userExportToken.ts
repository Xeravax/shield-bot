import { createHmac, timingSafeEqual } from "node:crypto";
import { TimeConstants } from "../config/constants.js";
import { getEnv } from "../config/env.js";

export const USER_EXPORT_TOKEN_TTL_MS = TimeConstants.HOUR;
const TOKEN_VERSION = "v1";
const DISCORD_ID_RE = /^\d{17,20}$/;

export function getUserExportSigningSecret(): string {
  const env = getEnv();
  return env.ENCRYPTION_KEY || env.BOT_TOKEN;
}

export function createUserExportToken(
  discordId: string,
  options?: { now?: number; ttlMs?: number; secret?: string },
): string {
  if (!DISCORD_ID_RE.test(discordId)) {
    throw new Error("Invalid Discord user id");
  }

  const now = options?.now ?? Date.now();
  const ttlMs = options?.ttlMs ?? USER_EXPORT_TOKEN_TTL_MS;
  const secret = options?.secret ?? getUserExportSigningSecret();
  const exp = Math.floor((now + ttlMs) / 1000);
  const payload = `${TOKEN_VERSION}.${discordId}.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyUserExportToken(
  token: string,
  options?: { now?: number; secret?: string },
): { discordId: string; exp: number } | null {
  if (!token || typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const [version, discordId, expRaw, mac] = parts;
  if (version !== TOKEN_VERSION || !DISCORD_ID_RE.test(discordId) || !mac) {
    return null;
  }

  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp <= 0) {
    return null;
  }

  const now = options?.now ?? Date.now();
  if (exp * 1000 <= now) {
    return null;
  }

  const secret = options?.secret ?? getUserExportSigningSecret();
  const payload = `${version}.${discordId}.${expRaw}`;
  const expected = sign(payload, secret);
  if (!safeEqual(mac, expected)) {
    return null;
  }

  return { discordId, exp };
}

export function buildUserExportViewUrl(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/export?t=${encodeURIComponent(token)}`;
}

export function getUserExportViewUrl(token: string): string {
  return buildUserExportViewUrl(getEnv().PUBLIC_API_BASE_URL, token);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
