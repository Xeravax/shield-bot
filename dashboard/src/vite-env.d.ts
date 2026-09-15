/// <reference types="vite/client" />

declare module "@locales/*.json" {
  const value: Record<string, unknown>;
  export default value;
}

interface ImportMetaEnv {
  readonly VITE_DISCORD_CLIENT_ID: string;
  readonly VITE_DEV_ACCESS_TOKEN?: string;
  readonly VITE_API_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
