-- AlterTable
ALTER TABLE `GuildSettings` ADD COLUMN `loggingForumChannelId` VARCHAR(191) NULL;
ALTER TABLE `GuildSettings` ADD COLUMN `welcomeChannelId` VARCHAR(191) NULL;
ALTER TABLE `GuildSettings` ADD COLUMN `loggingThreadIds` JSON NULL;
ALTER TABLE `GuildSettings` ADD COLUMN `messageArchiveRetentionDays` INTEGER NULL DEFAULT 30;
ALTER TABLE `GuildSettings` ADD COLUMN `loggingIgnoredChannelIds` JSON NULL;
ALTER TABLE `GuildSettings` ADD COLUMN `loggingIgnoredRoleIds` JSON NULL;
ALTER TABLE `GuildSettings` ADD COLUMN `inviteFilterEnabled` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `GuildSettings` ADD COLUMN `inviteFilterAction` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `cached_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NULL,
    `attachments` JSON NULL,
    `embeds` JSON NULL,
    `stickers` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `editedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cached_messages_messageId_key`(`messageId`),
    INDEX `cached_messages_guildId_idx`(`guildId`),
    INDEX `cached_messages_guildId_channelId_idx`(`guildId`, `channelId`),
    INDEX `cached_messages_authorId_idx`(`authorId`),
    INDEX `cached_messages_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_purge_archives` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `moderatorId` VARCHAR(191) NOT NULL,
    `messageCount` INTEGER NOT NULL,
    `txtContent` LONGTEXT NOT NULL,
    `logMessageId` VARCHAR(191) NULL,
    `logThreadId` VARCHAR(191) NULL,
    `caseId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `message_purge_archives_guildId_idx`(`guildId`),
    INDEX `message_purge_archives_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mod_cases` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(191) NOT NULL,
    `caseNumber` INTEGER NOT NULL,
    `type` ENUM('WARN', 'KICK', 'BAN', 'UNBAN', 'TIMEOUT', 'UNTIMEOUT', 'SOFTBAN', 'PURGE', 'FILTER', 'LOCK', 'UNLOCK', 'NOTE') NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `moderatorId` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `claimedBy` VARCHAR(191) NULL,
    `claimedReason` TEXT NULL,
    `claimedAt` DATETIME(3) NULL,
    `logMessageId` VARCHAR(191) NULL,
    `logThreadId` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `mod_cases_guildId_targetId_idx`(`guildId`, `targetId`),
    INDEX `mod_cases_expiresAt_idx`(`expiresAt`),
    INDEX `mod_cases_guildId_active_idx`(`guildId`, `active`),
    UNIQUE INDEX `mod_cases_guildId_caseNumber_key`(`guildId`, `caseNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mod_user_notes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `mod_user_notes_guildId_targetId_idx`(`guildId`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
