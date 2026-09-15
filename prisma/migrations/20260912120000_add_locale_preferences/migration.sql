-- AlterTable
ALTER TABLE `UserPreferences` ADD COLUMN `locale` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `GuildSettings` ADD COLUMN `locale` VARCHAR(191) NULL;
