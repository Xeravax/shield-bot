-- AlterTable
ALTER TABLE `GuildSettings` ADD COLUMN `eventDefaultDurationMinutes` INTEGER NULL,
    ADD COLUMN `eventDefaultLocation` VARCHAR(191) NULL,
    ADD COLUMN `eventPlanningChannelId` VARCHAR(191) NULL,
    ADD COLUMN `eventScheduleChannelId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `PlannedEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `startTime` DATETIME(3) NOT NULL,
    `hostId` VARCHAR(191) NOT NULL,
    `coHostId` VARCHAR(191) NULL,
    `coHostOpen` BOOLEAN NOT NULL DEFAULT false,
    `duty` ENUM('ON_DUTY', 'OFF_DUTY') NOT NULL,
    `status` ENUM('DRAFT', 'PENDING', 'APPROVED', 'DENIED') NOT NULL DEFAULT 'DRAFT',
    `denialReason` VARCHAR(191) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `planningMessageId` VARCHAR(191) NULL,
    `pendingCoHostUserId` VARCHAR(191) NULL,
    `coHostRequestMessageId` VARCHAR(191) NULL,
    `discordEventId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `PlannedEvent_guildId_status_startTime_idx`(`guildId`, `status`, `startTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `node` VARCHAR(191) NOT NULL,

    INDEX `RolePermission_guildId_idx`(`guildId`),
    UNIQUE INDEX `RolePermission_guildId_roleId_node_key`(`guildId`, `roleId`, `node`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
