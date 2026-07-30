-- AlterTable
ALTER TABLE `GuildSettings` ADD COLUMN `eventLocationChannelId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `PlannedEvent` ADD COLUMN `editResumeStatus` ENUM('DRAFT', 'PENDING', 'APPROVED', 'DENIED') NULL,
    ADD COLUMN `editSnapshot` JSON NULL;
