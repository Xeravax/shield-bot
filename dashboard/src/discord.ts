import { DiscordSDK } from "@discord/embedded-app-sdk";
import { exchangeToken } from "./api";

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string;

let sdk: DiscordSDK | null = null;
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

/** True when running inside Discord's Activity iframe (discordsays.com proxy). */
export function isDiscordActivity(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const host = window.location.hostname;
  if (host.endsWith("discordsays.com") || host.endsWith("discordapigames.com")) {
    return true;
  }
  // Local tunnel / URL override still runs in a Discord iframe
  try {
    return window.parent !== window && Boolean(document.referrer.includes("discord.com"));
  } catch {
    return window.parent !== window;
  }
}

export async function initDiscord(): Promise<void> {
  if (!clientId) {
    throw new Error(
      "VITE_DISCORD_CLIENT_ID is not set in this build. Set GitHub Actions variable DISCORD_CLIENT_ID and redeploy.",
    );
  }
  if (!isDiscordActivity()) {
    throw new Error(
      "Open this dashboard as a Discord Activity (not by visiting the domain directly). Check Activities → URL Mappings: / → dashboard.vrcshield.com",
    );
  }

  sdk = new DiscordSDK(clientId);
  try {
    await sdk.ready();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Discord Activity SDK handshake failed (${detail}). Usually: wrong Client ID in the build, or URL mapping / does not point at production (dashboard.vrcshield.com). Built clientId length=${clientId.length}.`,
      { cause: error },
    );
  }

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "guilds.members.read"],
  });

  accessToken = await exchangeToken(code);

  await sdk.commands.authenticate({ access_token: accessToken });
}

export async function openExternalLink(url: string): Promise<void> {
  if (!sdk) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await sdk.commands.openExternalLink({ url });
}

export function getDiscordSdk(): DiscordSDK | null {
  return sdk;
}

/** Dev fallback when not running inside Discord */
export async function initDevFallback(token: string): Promise<void> {
  accessToken = token;
}
