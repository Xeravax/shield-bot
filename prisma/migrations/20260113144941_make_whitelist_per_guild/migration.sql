/*
  Warnings:

  - You are about to drop the unique constraint on `whitelist_entries.userId`. This will allow duplicate entries per user.
  - The migration will duplicate existing whitelist entries to all guilds that have whitelist roles configured.

*/
-- Step 1: Add guildId column as nullable initially
ALTER TABLE `whitelist_entries` ADD COLUMN `guildId` VARCHAR(191) NULL;

-- Step 2: Find all unique guildIds from whitelist_roles and duplicate entries
-- For each existing whitelist_entry, create a new entry for each guild that has whitelist roles
-- Note: We insert without ON DUPLICATE KEY since the unique constraint doesn't exist yet
INSERT INTO `whitelist_entries` (`userId`, `guildId`, `createdAt`, `updatedAt`)
SELECT DISTINCT
    we.`userId`,
    wr.`guildId`,
    we.`createdAt`,
    we.`updatedAt`
FROM `whitelist_entries` we
CROSS JOIN (
    SELECT DISTINCT `guildId` FROM `whitelist_roles`
) wr
WHERE we.`guildId` IS NULL;

-- Step 3: Migrate role assignments to new entries
-- For each role assignment, find the new entry that matches userId + role's guildId
-- Only migrate assignments where the role's guildId matches the new entry's guildId
INSERT INTO `whitelist_role_assignments` (`whitelistId`, `roleId`, `assignedAt`, `assignedBy`, `expiresAt`)
SELECT 
    new_we.`id` AS `whitelistId`,
    wra.`roleId`,
    wra.`assignedAt`,
    wra.`assignedBy`,
    wra.`expiresAt`
FROM `whitelist_role_assignments` wra
INNER JOIN `whitelist_entries` old_we ON wra.`whitelistId` = old_we.`id`
INNER JOIN `whitelist_roles` wr ON wra.`roleId` = wr.`id`
INNER JOIN `whitelist_entries` new_we ON new_we.`userId` = old_we.`userId` AND new_we.`guildId` = wr.`guildId`
WHERE old_we.`guildId` IS NULL
ON DUPLICATE KEY UPDATE `assignedAt` = VALUES(`assignedAt`);

-- Step 4: Delete old entries that don't have guildId (after migration)
DELETE FROM `whitelist_entries` WHERE `guildId` IS NULL;

-- Step 5: Make guildId non-nullable
ALTER TABLE `whitelist_entries` MODIFY COLUMN `guildId` VARCHAR(191) NOT NULL;

-- Step 6: Drop foreign key constraint (it depends on the unique index)
ALTER TABLE `whitelist_entries` DROP FOREIGN KEY `whitelist_entries_userId_fkey`;

-- Step 7: Drop old unique constraint on userId
DROP INDEX `whitelist_entries_userId_key` ON `whitelist_entries`;

-- Step 8: Recreate foreign key constraint (doesn't require uniqueness on source column)
ALTER TABLE `whitelist_entries` ADD CONSTRAINT `whitelist_entries_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 9: Create new unique constraint on userId + guildId
CREATE UNIQUE INDEX `whitelist_entries_userId_guildId_key` ON `whitelist_entries`(`userId`, `guildId`);

-- Step 10: Create indexes for performance
CREATE INDEX `whitelist_entries_guildId_idx` ON `whitelist_entries`(`guildId`);
CREATE INDEX `whitelist_entries_userId_guildId_idx` ON `whitelist_entries`(`userId`, `guildId`);
