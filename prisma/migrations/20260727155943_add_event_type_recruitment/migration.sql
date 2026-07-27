-- AlterTable
ALTER TABLE `PlannedEvent` MODIFY `eventType` ENUM('PATROL', 'GAME', 'SPECIAL', 'RECRUITMENT', 'OTHER') NULL;
