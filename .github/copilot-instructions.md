# Shield Bot Development Guide

## Architecture Overview

This is a Discord.js v14 bot with VRChat API integration, built using TypeScript and the DiscordX framework. The bot manages VRChat account verification, attendance tracking, patrol systems, and whitelisting.

## Key Technologies & Patterns

- **Framework**: DiscordX with decorators (`@Discord`, `@Slash`, `@SlashGroup`, `@Guard`, `@ButtonComponent`)
- **Database**: Prisma ORM with MySQL, split schema files in `prisma/models/`
- **Build**: TypeScript ESM targeting `build/` directory via `yarn build`
- **VRChat Integration**: Custom WebSocket listener + REST API wrapper in `src/utility/vrchat/`

## Essential Patterns

### Command Structure
Commands use nested SlashGroups with guards:
```typescript
@Discord()
@SlashGroup({ name: "verify", description: "VRChat verification commands" })
@SlashGroup("verify")
@Guard(VRChatLoginGuard)
export class VRChatVerifyAccountCommand {
  @Slash({ name: "account", description: "Start verification" })
  async verify(@SlashOption(...) userIdOpt: string, interaction: CommandInteraction) {}
}
```

### Button Interactions
Button handlers use regex patterns to extract parameters:
```typescript
@ButtonComponent({ id: /vrchat-verify:(\d+):([a-zA-Z0-9\-_]+)/ })
async handleConfirm(interaction: ButtonInteraction) {
  const [_, discordId, vrcUserId] = interaction.customId.split(":");
}
```

### Guards & Permissions
Custom guards in `src/utility/guards.ts` protect commands:
- `VRChatLoginGuard`: Ensures VRChat API is authenticated
- `StaffGuard`, `DevGuardAndStaffGuard`: Role-based permissions via `src/utility/permissionUtils.ts`

### VRChat Integration
- **Authentication**: Bot logs into VRChat on startup (`src/main.ts`)
- **WebSocket**: Real-time events via `src/events/vrchat/vrchat-websocket.ts`
- **Event Handlers**: Modular handlers in `src/events/vrchat/handlers/` for friend adds, location updates, etc.

### Database Patterns
- **Models**: Split across `prisma/models/` files (user.prisma, enums.prisma, etc.)
- **Verification Flow**: `VRChatAccount` uses `accountType` enum (IN_VERIFICATION → MAIN/ALT)
- **Singleton**: Global `prisma` client exported from `src/main.ts`

### Manager Pattern
Singletons in `src/managers/` handle complex business logic:
- `WhitelistManager`: Role-based VRChat world access
- `PatrolTimerManager`: Voice channel time tracking
- `InviteMessageManager`: Dynamic Discord invite syncing

## Development Workflow

### Build & Run
```bash
yarn build          # Compile TypeScript to build/
yarn dev            # Development with ts-node-esm
yarn start          # Production from build/
```

### Database
```bash
prisma migrate dev  # Apply schema changes
prisma studio       # Database GUI
```

### Key Environment Variables
- `BOT_TOKEN`: Discord bot token
- `DATABASE_URL`: MySQL connection string  
- `VRCHAT_USERNAME`/`VRCHAT_PASSWORD`: Bot's VRChat credentials

## Critical Integration Points

- **Startup Sequence**: VRChat login → schedules → patrol timer → WebSocket (see `src/main.ts`)
- **Verification Flow**: Account command → button interactions → friend request/status verification → database promotion
- **Event Processing**: VRChat WebSocket events automatically trigger verification completions and whitelist updates
- **API Server**: Koa server runs alongside Discord bot for web endpoints
- **Imports**: ESM with `.js` extensions in imports, even for `.ts` files. Any methods should be imported to the top level. Never import inside functions.
## Common Gotchas

- VRChat API requires user-agent headers and cookie-based authentication
- Button `customId` length is limited; use compact encoding for parameters
- Prisma schema is split across multiple files; changes require migration
- ESM imports must use `.js` extensions even for `.ts` files
- Discord interactions have 3-second response timeout; use `deferReply()` for long operations
- Never create summery documents, these are not required.