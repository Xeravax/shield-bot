-- CreateIndex
CREATE INDEX `VoicePatrolPromotion_user_idx` ON `VoicePatrolPromotion`(`userId`);

-- CreateIndex
CREATE INDEX `VoicePatrolPromotionNotification_user_idx` ON `VoicePatrolPromotionNotification`(`userId`);

-- AddForeignKey
ALTER TABLE `VoicePatrolPromotion` ADD CONSTRAINT `VoicePatrolPromotion_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`discordId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VoicePatrolPromotionNotification` ADD CONSTRAINT `VoicePatrolPromotionNotification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`discordId`) ON DELETE RESTRICT ON UPDATE CASCADE;
