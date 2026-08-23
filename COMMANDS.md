# Shield Bot Commands

## Verification Commands
- `/verify account` - Start VRChat account verification (link Discord to VRChat)
- `/verify manage [user]` - Manage MAIN/ALT status for verified accounts (staff can manage any user)
- `/verify avatar-invite` - Send avatar world invite message (Staff)

## User Commands
- `/user permission [user]` - Check user's permission level or list all permission levels
- `/user export` - Export your own data (JSON file)
- `/user group join` - Request invite to SHIELD VRChat group
- `/group sync-me` - Sync Discord roles to VRChat group roles

## Group Commands
- `/group join` - Request invite to SHIELD VRChat group
- `/group sync-me` - Sync your Discord roles to VRChat group roles
- `/group role-sync <user>` - Manually sync a user's Discord roles to VRChat
- `/group bulk-role-sync` - Bulk sync all verified users' roles
- `/group role map/unmap/list/fetch-roles` - Map Discord roles to VRChat group roles
- `/group config set-group-id/view-group-id/clear-group-id` - VRChat group ID management
- `/group config set-promotion-logs/view-promotion-logs` - Promotion log channels

## Attendance Commands
- `/attendance event <action>` - Manage events: create/list/select/delete
- `/attendance member <action>` - Manage squad members: add/remove/move/split
- `/attendance status` - Manage member status: mark late/left/unleft
- `/attendance role` - Manage roles: set lead/staff/cohost, remove lead
- `/attendance paste [event_id]` - Generate copyable attendance text
- `/attendance autofill` - Auto-fill attendance from voice channels

## Patrol Commands
- `/patrol current` - Show currently tracked users in voice channels
- `/patrol top [limit]` - Show top users by patrol time
- `/patrol time [user]` - Check patrol time (own or others if staff)
- `/patrol manage <action>` - Admin: wipe/adjust/pause/unpause patrol data
- `/patrol promotion check/suggest/check-all/resuggest-all/list-notifications/reset-user/block-suggest/unblock-suggest` - Promotion eligibility and notification actions

## Role Tracking Commands
- `/role-tracking config` - Role tracking configuration (add-role, thresholds, conditions, warnings, staff pings, view-config)
- `/role-tracking manage` - Open role tracking manager UI
- `/role-tracking reset-timer/sync-role-members/cleanup/query-patrol-time/list-users/list-warnings/list-warning-history/view-conditions/view-staff-ping` - Operational role tracking actions

## Server Stats Commands
- `/server-stats refresh` - Force refresh all configured stats channels
- `/server-stats status` - Show configured channels and live computed values

## Whitelist Commands (Staff)
- `/whitelist role <action>` - Manage role mappings: setup/remove/list
- `/whitelist user <action>` - User operations: info/sync/browse
- `/whitelist generate` - Generate and publish whitelist to GitHub
- `/whitelist validate [user]` - Validate and cleanup whitelist access
- `/whitelist stats` - View whitelist statistics

## VRChat Commands
- `/vrchat status [show_history]` - Check VRChat service status/incidents
- `/vrchat request <type>` - Request backup or log dispatch (backup/dispatch, world link required for dispatch)

## Settings Commands (Staff)
- `/settings patrol top-channel/setup-category/alone-exclude` - Patrol channel and category settings
- `/settings patrol set-channel/set-to-promote-channel/view/disable/add-rule/remove-rule/edit-rule/list-rules` - Promotion notification configuration
- `/settings attendance add-channel/remove-channel` - Manage enrolled attendance channels
- `/settings attendance aoc-voice-channel` - AoC voice channel for live phantom-compiler panel
- `/settings attendance emt-voice-channel` - EMT voice channel for the same phantom-compiler panel
- `/settings server-stats setup/goal-channel/members-channel/deputies-channel/boosts-channel` - Server stats channel bindings
- `/settings whitelist gh-token/gh-repo/gh-branch/gh-paths/gh-key/view/log-channel/clear-log-channel` - Whitelist GitHub and log channel settings
- `/settings vrchat set-avatar-world/remove-avatar-world` - Avatar world ID config
- `/settings events` - Event scheduling and reminder settings
- `/settings loa` - LOA settings
- `/settings logging` - Audit forum, welcome channel, retention, invite filter

## Permissions
- `/permissions grant <role> <node>` - Grant a permission node (or wildcard) to a role
- `/permissions revoke <role> <node>` - Revoke a permission node from a role
- `/permissions list [role]` - List permission node grants

## Phantom Compiler
- `/phantomcompiler panel` - Staff: post self-service enrollment panel (Enroll/Update opens a reason modal; Unenroll removes you)
- `/phantomcompiler enroll <reason>` - Enroll your MAIN account (use `\n` in reason for line breaks)
- `/phantomcompiler add <user> <reason>` - Staff: enroll a member on the phantom compiler list
- `/phantomcompiler unenroll` - Remove your enrollment

## Dev Commands (Bot Owner)
- `/eval <code>` - Evaluate JavaScript code for debugging
- `/dev servers` - List all servers (name, owner, member count)
- `/dev leave-guild <guild_id>` - Make the bot leave a guild by ID
