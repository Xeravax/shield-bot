# Shield Bot Commands

## Verification Commands
- `/verify account` - Start VRChat account verification (link Discord to VRChat)
- `/verify manage [user]` - Manage MAIN/ALT status for verified accounts (staff can manage any user)

## User Commands
- `/user permission [user]` - Check user's permission level or list all permission levels
- `/user export` - Export your own data (JSON file)
- `/user group join` - Request invite to SHIELD VRChat group
- `/user group syncme` - Sync Discord roles to VRChat group roles

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

## Whitelist Commands (Staff)
- `/whitelist role <action>` - Manage role mappings: setup/remove/list
- `/whitelist user <action>` - User operations: info/sync/browse
- `/whitelist generate` - Generate and publish whitelist to GitHub
- `/whitelist validate [user]` - Validate and cleanup whitelist access
- `/whitelist stats` - View whitelist statistics

## VRChat Commands
- `/vrchat status [show_history]` - Check VRChat service status/incidents
- `/vrchat request <type>` - Request backup or log dispatch (backup/dispatch, world link required for dispatch)
- `/vrchat avatar-invite` - Send avatar world invite message (Staff)

## Settings Commands (Staff)
- `/settings roles add/remove/status` - Manage Discord role to permission mappings
- `/settings group set-group-id/view-group-id/clear-group-id` - VRChat group ID management
- `/settings group set-promotion-logs/view-promotion-logs` - Promotion log channels
- `/settings group role map/unmap/list` - Map Discord roles to VRChat group roles
- `/settings group rolesync` - Manually sync user's Discord to VRChat roles
- `/settings group bulkrolesync` - Sync all verified users' roles
- `/settings patrol setup-category` - Set tracked voice category for patrol
- `/settings patrol promotion set-channel/set-role/set-hours/view/reset/check/check-all` - Promotion system config
- `/settings attendance add-channel/remove-channel` - Manage enrolled attendance channels
- `/settings whitelist set-log-channel/remove-log-channel` - Whitelist log channels
- `/settings vrchat set-avatar-world/remove-avatar-world` - Avatar world ID config

## Dev Commands (Bot Owner)
- `/eval <code>` - Evaluate JavaScript code for debugging

