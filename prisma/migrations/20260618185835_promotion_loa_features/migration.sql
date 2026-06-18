-- AlterTable
ALTER TABLE `VoicePatrolRoleObtainedAt` ADD COLUMN `cooldownPauseAccumulatedMs` BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN `cooldownPausedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `VoicePatrolPromotionBlock` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `setBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VoicePatrolPromotionBlock_guild_idx`(`guildId`),
    INDEX `VoicePatrolPromotionBlock_user_idx`(`userId`),
    UNIQUE INDEX `VoicePatrolPromotionBlock_guild_user_unique`(`guildId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `VoicePatrolPromotionBlock` ADD CONSTRAINT `VoicePatrolPromotionBlock_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`discordId`) ON DELETE CASCADE ON UPDATE CASCADE;
