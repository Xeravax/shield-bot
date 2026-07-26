-- AlterTable
ALTER TABLE `GuildSettings` ADD COLUMN `eventOnDutyScheduleChannelId` VARCHAR(191) NULL,
    ADD COLUMN `eventOffDutyScheduleChannelId` VARCHAR(191) NULL,
    ADD COLUMN `eventOnDutyPingRoleId` VARCHAR(191) NULL,
    ADD COLUMN `eventOffDutyPingRoleIds` JSON NULL,
    ADD COLUMN `eventPatrolEmojiName` VARCHAR(191) NULL,
    ADD COLUMN `eventPatrolEmojiId` VARCHAR(191) NULL;
