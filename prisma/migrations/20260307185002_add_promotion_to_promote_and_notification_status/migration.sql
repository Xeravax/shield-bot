-- DropForeignKey
ALTER TABLE `ActiveAttendanceEvent` DROP FOREIGN KEY `ActiveAttendanceEvent_userId_fkey`;

-- DropForeignKey
ALTER TABLE `AttendanceStaff` DROP FOREIGN KEY `AttendanceStaff_userId_fkey`;

-- DropForeignKey
ALTER TABLE `SquadMember` DROP FOREIGN KEY `SquadMember_userId_fkey`;

-- DropForeignKey
ALTER TABLE `VRChatAccount` DROP FOREIGN KEY `VRChatAccount_userId_fkey`;

-- DropForeignKey
ALTER TABLE `VoicePatrolMonthlyTime` DROP FOREIGN KEY `VoicePatrolMonthlyTime_userId_fkey`;

-- DropForeignKey
ALTER TABLE `VoicePatrolPromotionNotification` DROP FOREIGN KEY `VoicePatrolPromotionNotification_userId_fkey`;

-- DropForeignKey
ALTER TABLE `VoicePatrolRoleObtainedAt` DROP FOREIGN KEY `VoicePatrolRoleObtainedAt_userId_fkey`;

-- DropForeignKey
ALTER TABLE `VoicePatrolTime` DROP FOREIGN KEY `VoicePatrolTime_userId_fkey`;

-- AlterTable
ALTER TABLE `GuildSettings` ADD COLUMN `toPromoteChannelId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `VoicePatrolPromotionNotification` ADD COLUMN `messageId` VARCHAR(191) NULL,
    ADD COLUMN `resolvedAt` DATETIME(3) NULL,
    ADD COLUMN `resolvedBy` VARCHAR(191) NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX `ActiveVoicePatrolSession_user_idx` ON `ActiveVoicePatrolSession`(`userId`);

-- CreateIndex
CREATE INDEX `VoicePatrolPromotionNotification_message_idx` ON `VoicePatrolPromotionNotification`(`messageId`);

-- AddForeignKey
ALTER TABLE `SquadMember` ADD CONSTRAINT `SquadMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AttendanceStaff` ADD CONSTRAINT `AttendanceStaff_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActiveAttendanceEvent` ADD CONSTRAINT `ActiveAttendanceEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VoicePatrolTime` ADD CONSTRAINT `VoicePatrolTime_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`discordId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VoicePatrolMonthlyTime` ADD CONSTRAINT `VoicePatrolMonthlyTime_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`discordId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActiveVoicePatrolSession` ADD CONSTRAINT `ActiveVoicePatrolSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`discordId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VoicePatrolPromotionNotification` ADD CONSTRAINT `VoicePatrolPromotionNotification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`discordId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VoicePatrolRoleObtainedAt` ADD CONSTRAINT `VoicePatrolRoleObtainedAt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`discordId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VRChatAccount` ADD CONSTRAINT `VRChatAccount_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
