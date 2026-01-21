/*
  Warnings:

  - A unique constraint covering the columns `[guildId,userId,roleId,warningIndex,roleAssignedAt]` on the table `RoleTrackingWarning` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX `RoleTrackingWarning_duplicate_prevention_idx` ON `RoleTrackingWarning`;

-- CreateIndex
CREATE UNIQUE INDEX `RoleTrackingWarning_duplicate_prevention_unique` ON `RoleTrackingWarning`(`guildId`, `userId`, `roleId`, `warningIndex`, `roleAssignedAt`);
