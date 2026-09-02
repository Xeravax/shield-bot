import { DiscordSDK } from "@discord/embedded-app-sdk";
import { exchangeToken } from "./api";

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string;

let sdk: DiscordSDK | null = null;
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export async function initDiscord(): Promise<void> {
  if (!clientId) {
    throw new Error("VITE_DISCORD_CLIENT_ID is not set");
  }

  sdk = new DiscordSDK(clientId);
  await sdk.ready();

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
