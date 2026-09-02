# SHIELD Discord Activity Dashboard — Setup

## Discord Developer Portal

1. **Application** → enable **Activities** (Settings → Enable Activities).
2. **OAuth2** → add redirect `https://127.0.0.1` (required placeholder; SDK handles in-client flow).
3. **Activities → URL Mappings** (targets omit `https://`):

   | Prefix | Target |
   |--------|--------|
   | `/` | `dashboard.vrcshield.com` |
   | `/api` | `api.vrcshield.com/api` |

4. **Activities → Art Assets** — cover, background, tile for the Activity shelf.
5. Copy **Client ID** → `APPLICATION_ID` (bot) and `VITE_DISCORD_CLIENT_ID` (dashboard build).
6. Copy **Client Secret** → `DISCORD_CLIENT_SECRET` (bot only, never in the SPA).

### Launching

Always open the dashboard **from Discord as an Activity** (voice channel → Activities / app launcher). Visiting `https://dashboard.vrcshield.com` in a normal browser will not work — the Embedded App SDK requires Discord’s iframe (`*.discordsays.com`) and will error with `RPCError: Invalid Origin`.

If the Activity still fails after launching in Discord:

- Confirm `/` maps to `dashboard.vrcshield.com` (no `https://`).
- Confirm the deployed build’s `VITE_DISCORD_CLIENT_ID` / GitHub variable `DISCORD_CLIENT_ID` matches this application’s Client ID.
- Hard-refresh or re-launch the Activity after changing URL mappings (proxy cache).

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
| `dashboard.roles.host` | Host tab (or use `roles.host` / `roles.jrhost`) |
| `dashboard.roles.trainer.emt` | EMT trainer tab content |
| `dashboard.roles.trainer.tru` | TRU trainer tab content |
| `dashboard.roles.trainer.cadet` | Cadet trainer tab content |

> Enabling Activities creates a global **Entry Point** slash command (`Launch`). The bot preserves it during command sync (Discord API 50240 if omitted).

## Cloudflare Pages

- Project name: `shield-dashboard` (must match CI workflow).
- Custom domain: `dashboard.vrcshield.com` (Pages → Custom domains → attach to **production**).
- Pages **Production branch** must be `dashboard` so CI’s `--branch=dashboard` updates the live domain.

### Deploy flow (GitHub Actions)

1. Push dashboard changes to git **`main`** (paths under `dashboard/` or the workflow file).
2. CI builds the SPA with `VITE_DISCORD_CLIENT_ID` from GitHub variable `DISCORD_CLIENT_ID`.
3. If `dashboard/` differs from the tip of the git **`dashboard`** tracking branch, CI fast-forwards that git branch.
4. CI deploys `dashboard/dist` to Cloudflare Pages **production** (`--branch=dashboard`).
5. Manual runs: **Actions → Deploy Dashboard → Run workflow** always rebuilds and deploys.

**Do not confuse:**

| URL | What it is |
|-----|------------|
| `https://shield-dashboard.pages.dev` | Production Pages host |
| `https://dashboard.vrcshield.com` | Custom domain → production |
| `https://<hash>.shield-dashboard.pages.dev` | One-off deploy URL (fine if that deploy is marked Production) |

Discord URL mapping `/` must target the **production** host (`dashboard.vrcshield.com` or `shield-dashboard.pages.dev`).

## GitHub Actions secrets

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- Repository variable `DISCORD_CLIENT_ID` (for Vite build)

## Local development

```bash
cd dashboard && npm install && npm run dev
cloudflared tunnel --url http://localhost:5173
```

Map the tunnel host to `/` in URL Mappings, launch the Activity from Discord Developer Mode.
