# Discord Activity dashboard (Vite + React)

Static SPA deployed to Cloudflare Pages. See [DASHBOARD_SETUP.md](./DASHBOARD_SETUP.md).

```bash
npm install
npm run dev
```

Set `VITE_DISCORD_CLIENT_ID` in `.env.local` (same as bot `APPLICATION_ID`).

For local API testing without Discord, set `VITE_DEV_ACCESS_TOKEN` to a valid Discord OAuth bearer token.
