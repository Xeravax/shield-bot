-- AlterTable
ALTER TABLE `GuildSettings` ADD COLUMN `modCaseCounter` INTEGER NOT NULL DEFAULT 0;

-- Ensure GuildSettings rows exist for guilds that already have mod cases
INSERT INTO `GuildSettings` (`guildId`, `modCaseCounter`, `inviteFilterEnabled`, `createdAt`, `updatedAt`)
SELECT `m`.`guildId`, MAX(`m`.`caseNumber`), false, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `mod_cases` AS `m`
LEFT JOIN `GuildSettings` AS `gs` ON `gs`.`guildId` = `m`.`guildId`
WHERE `gs`.`guildId` IS NULL
GROUP BY `m`.`guildId`;

-- Backfill counters from existing cases
UPDATE `GuildSettings` AS `gs`
LEFT JOIN (
  SELECT `guildId`, MAX(`caseNumber`) AS `maxCase`
  FROM `mod_cases`
  GROUP BY `guildId`
) AS `mc` ON `mc`.`guildId` = `gs`.`guildId`
SET `gs`.`modCaseCounter` = COALESCE(`mc`.`maxCase`, 0);
