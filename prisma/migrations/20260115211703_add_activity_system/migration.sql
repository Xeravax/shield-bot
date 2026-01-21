-- AlterTable
ALTER TABLE `GuildSettings` ADD COLUMN `roleTrackingConfig` JSON NULL,
    ADD COLUMN `roleTrackingInitializedAt` DATETIME(3) NULL,
    ADD COLUMN `roleTrackingStaffChannelId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `RoleAssignmentTracking` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL,
    `assignedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RoleAssignmentTracking_guild_idx`(`guildId`),
    INDEX `RoleAssignmentTracking_user_idx`(`userId`),
    INDEX `RoleAssignmentTracking_role_idx`(`roleId`),
    INDEX `RoleAssignmentTracking_guild_user_idx`(`guildId`, `userId`),
    UNIQUE INDEX `RoleAssignmentTracking_guild_user_role_unique`(`guildId`, `userId`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RoleTrackingWarning` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `warningType` VARCHAR(191) NOT NULL,
    `warningIndex` INTEGER NOT NULL,
    `sentAt` DATETIME(3) NOT NULL,
    `roleAssignedAt` DATETIME(3) NOT NULL,
    `assignmentTrackingId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RoleTrackingWarning_guild_idx`(`guildId`),
    INDEX `RoleTrackingWarning_user_idx`(`userId`),
    INDEX `RoleTrackingWarning_role_idx`(`roleId`),
    INDEX `RoleTrackingWarning_guild_user_role_idx`(`guildId`, `userId`, `roleId`),
    INDEX `RoleTrackingWarning_duplicate_prevention_idx`(`guildId`, `userId`, `roleId`, `warningIndex`, `roleAssignedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RoleAssignmentTracking` ADD CONSTRAINT `RoleAssignmentTracking_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoleTrackingWarning` ADD CONSTRAINT `RoleTrackingWarning_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoleTrackingWarning` ADD CONSTRAINT `RoleTrackingWarning_assignmentTrackingId_fkey` FOREIGN KEY (`assignmentTrackingId`) REFERENCES `RoleAssignmentTracking`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
