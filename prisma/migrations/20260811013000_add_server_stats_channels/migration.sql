-- AlterTable
ALTER TABLE `GuildSettings` ADD COLUMN `serverStatsCategoryId` VARCHAR(191) NULL;
ALTER TABLE `GuildSettings` ADD COLUMN `serverStatsGoalChannelId` VARCHAR(191) NULL;
ALTER TABLE `GuildSettings` ADD COLUMN `serverStatsMembersChannelId` VARCHAR(191) NULL;
ALTER TABLE `GuildSettings` ADD COLUMN `serverStatsDeputiesChannelId` VARCHAR(191) NULL;
ALTER TABLE `GuildSettings` ADD COLUMN `serverStatsBoostsChannelId` VARCHAR(191) NULL;
