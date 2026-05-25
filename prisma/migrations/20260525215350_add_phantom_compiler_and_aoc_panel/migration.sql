-- AlterTable
ALTER TABLE `GuildSettings` ADD COLUMN `aocPanelMessageId` VARCHAR(191) NULL,
    ADD COLUMN `aocVoiceChannelId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `VRChatAccount` ADD COLUMN `phantomCompilerEnrolledAt` DATETIME(3) NULL,
    ADD COLUMN `phantomCompilerReason` TEXT NULL;
