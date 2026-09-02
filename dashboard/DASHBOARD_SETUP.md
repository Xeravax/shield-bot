# SHIELD Discord Activity Dashboard — Setup

## How Discord loads the Activity (important)

Inside Discord, the dashboard does **not** run as `https://dashboard.vrcshield.com`. It runs as:

`https://<CLIENT_ID>.discordsays.com/`

Discord’s proxy fetches your files from the URL Mapping **target**, then serves them under `discordsays.com`. The iframe origin stays on the proxy forever.

| Layer | Role |
|-------|------|
| Browser / SDK | `https://<CLIENT_ID>.discordsays.com/...` |
| URL Mapping `/` | Discord fetches SPA from `dashboard.vrcshield.com` (or `shield-dashboard.pages.dev`) |
| URL Mapping `/api` | Relative `/api/...` from the SPA → Discord fetches `api.vrcshield.com/api/...` |

**Rules for the SPA**

- Use **relative** paths only (`/api/dashboard/...`, `/logo.png`, `/assets/...`).
- Never navigate the iframe to `dashboard.vrcshield.com` or hardcode that host for fetches.
- Open handbooks / calendars with `sdk.commands.openExternalLink` (already used), not in-iframe navigation.
- OAuth is via Embedded App SDK `authorize` → bot exchanges the code; not a browser redirect to your custom domain.

Visiting the custom domain in Chrome is fine for a static peek, but the SDK will not work there (`RPCError: Invalid Origin`). Always launch from Discord.

## Discord Developer Portal

1. **Application** → enable **Activities**.
2. **OAuth2** → add redirect `https://127.0.0.1` (placeholder; SDK handles in-client auth).
3. **Activities → URL Mappings** (targets omit `https://`):

   | Prefix | Target | Meaning |
   |--------|--------|---------|
   | `/` | `dashboard.vrcshield.com` | Where Discord **fetches** the SPA (not the iframe URL) |
   | `/api` | `api.vrcshield.com/api` | Where Discord **fetches** API calls to `/api/*` |

4. **Activities → Art Assets** — cover, background, tile.
5. Client ID → `APPLICATION_ID` (bot) and GitHub var `DISCORD_CLIENT_ID` / `VITE_DISCORD_CLIENT_ID`.
6. Client Secret → `DISCORD_CLIENT_SECRET` (bot only).

### Launching

Voice channel → Activities / app launcher / Entry Point (`Launch`). Dev Mode URL Override is only for local tunnels.

If SDK handshake fails inside Discord:

- Client ID in the **built** SPA matches this application.
- Mapping `/` points at **production** Pages (no preview hash URL).
- Cloudflare is not 301-redirecting the mapped host to a different hostname in a way that breaks the proxy (prefer mapping directly to the host that serves 200 HTML).
- Re-launch the Activity after mapping changes.

## Bot environment

```env
APPLICATION_ID=...
DISCORD_CLIENT_SECRET=...
DASHBOARD_GUILD_ID=1241178553111019522
```

## Permission nodes

Grant via `/permissions grant`:

| Node | Purpose |
|------|---------|
| `patrol.tracked` | Recruit+ — hours, calendar, handbook links |
| `patrol.avatar` | Deputy+ — 2026 avatar guidelines link |
| `dashboard.roles.staff` | Admin tab |
| `dashboard.roles.host` | Host tab (or `roles.host` / `roles.jrhost`) |
| `events.manage.approve` | Hosting team lead — edit any queued event; host tab |
| `events.schedule.force` | Bypass week/collision rules when scheduling from the dashboard |
| `dashboard.roles.trainer.emt` | EMT trainer tab content |
| `dashboard.roles.trainer.tru` | TRU trainer tab content |
| `dashboard.roles.trainer.cadet` | Cadet trainer tab content |

> Enabling Activities creates a global **Entry Point** command (`Launch`). The bot preserves it during command sync (API 50240 if omitted).

Dashboard API actions (login, timezone, event drafts, staff hour/modlog lookups and adjustments) are posted to the staff-logs forum thread **Dashboard Log**. Re-run logging setup / ensure threads if that category is missing on an existing forum.

## Cloudflare Pages

- Project: `shield-dashboard`
- Custom domain: `dashboard.vrcshield.com` (production) — this is the **mapping target**, not the Activity iframe URL
- Production branch: `dashboard` (matches CI `--branch=dashboard`)

### Deploy flow

1. Push SPA changes to git `main`.
2. CI builds with `VITE_DISCORD_CLIENT_ID`.
3. CI updates git `dashboard` tracking branch when needed.
4. CI deploys `dashboard/dist` to Pages production (`--branch=dashboard`).

| URL | What it is |
|-----|------------|
| `https://<CLIENT_ID>.discordsays.com/` | What users actually run inside Discord |
| `https://dashboard.vrcshield.com` | Pages custom domain (proxy fetch target / optional browser preview) |
| `https://shield-dashboard.pages.dev` | Pages production alias |

## GitHub Actions

- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Variable: `DISCORD_CLIENT_ID`

## Local development

```bash
cd dashboard && npm install && npm run dev
cloudflared tunnel --url http://localhost:5173
```

Map `/` to the tunnel host (no `https://`), launch the Activity from Discord.
