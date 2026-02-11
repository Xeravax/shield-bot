-- AlterTable
ALTER TABLE `GuildSettings` ADD COLUMN `promotionRules` JSON NULL;

-- CreateTable
CREATE TABLE `VoicePatrolPromotionNotification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `nextRankRoleId` VARCHAR(191) NOT NULL,
    `totalHoursAtNotify` DOUBLE NULL,
    `notifiedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VoicePatrolPromotionNotification_guild_idx`(`guildId`),
    UNIQUE INDEX `VoicePatrolPromotionNotification_guild_user_next_rank_unique`(`guildId`, `userId`, `nextRankRoleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
