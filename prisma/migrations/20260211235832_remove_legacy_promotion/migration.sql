/*
  Warnings:

  - You are about to drop the column `promotionMinHours` on the `GuildSettings` table. All the data in the column will be lost.
  - You are about to drop the column `promotionRecruitRoleId` on the `GuildSettings` table. All the data in the column will be lost.
  - You are about to drop the `VoicePatrolPromotion` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `VoicePatrolPromotion` DROP FOREIGN KEY `VoicePatrolPromotion_userId_fkey`;

-- AlterTable
ALTER TABLE `GuildSettings` DROP COLUMN `promotionMinHours`,
    DROP COLUMN `promotionRecruitRoleId`;

-- DropTable
DROP TABLE `VoicePatrolPromotion`;
