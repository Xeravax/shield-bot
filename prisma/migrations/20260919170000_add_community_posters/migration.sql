-- CreateTable
CREATE TABLE `community_posters` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(191) NOT NULL,
    `slot` INTEGER NOT NULL,
    `slug` VARCHAR(191) NOT NULL DEFAULT '',
    `title` VARCHAR(191) NOT NULL DEFAULT '',
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `community_posters_guildId_slot_key`(`guildId`, `slot`),
    INDEX `community_posters_guildId_idx`(`guildId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_poster_state` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `community_poster_state_guildId_key`(`guildId`),
    INDEX `community_poster_state_guildId_idx`(`guildId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
