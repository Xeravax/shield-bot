-- CreateTable
CREATE TABLE `vrchat_observed_profiles` (
    `vrcUserId` VARCHAR(64) NOT NULL,
    `displayName` VARCHAR(191) NULL,
    `username` VARCHAR(191) NULL,
    `pronouns` VARCHAR(64) NULL,
    `status` VARCHAR(32) NULL,
    `statusDescription` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`vrcUserId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
