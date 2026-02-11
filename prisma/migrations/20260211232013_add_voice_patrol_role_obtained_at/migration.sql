-- CreateTable
CREATE TABLE `VoicePatrolRoleObtainedAt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `obtainedAt` DATETIME(3) NOT NULL,

    INDEX `VoicePatrolRoleObtainedAt_guild_idx`(`guildId`),
    INDEX `VoicePatrolRoleObtainedAt_user_idx`(`userId`),
    UNIQUE INDEX `VoicePatrolRoleObtainedAt_guild_user_role_unique`(`guildId`, `userId`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `VoicePatrolRoleObtainedAt` ADD CONSTRAINT `VoicePatrolRoleObtainedAt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`discordId`) ON DELETE RESTRICT ON UPDATE CASCADE;
