-- Delete existing UNVERIFIED accounts before removing the enum value
DELETE FROM `VRChatAccount` WHERE `accountType` = 'UNVERIFIED';

-- AlterTable
ALTER TABLE `VRChatAccount` MODIFY `accountType` ENUM('MAIN', 'ALT', 'IN_VERIFICATION') NOT NULL DEFAULT 'IN_VERIFICATION';
