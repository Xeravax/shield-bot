import fs from "fs";
import path from "path";

const root = "src/commands";
const settingsPath = path.join(root, "settings/roleTracking/roleTrackingSettings.ts");
const warningsPath = path.join(root, "settings/roleTracking/roleTrackingWarningCommands.ts");
const actionsPath = path.join(root, "roleTracking/roleTrackingActions.ts");

const ACTION_SLASH_NAMES = new Set([
  "manage",
  "reset-timer",
  "sync-role-members",
  "cleanup",
  "list-users",
  "view-conditions",
  "view-staff-ping",
  "query-patrol-time",
  "list-warnings",
  "list-warning-history",
]);

function renameConfig(content) {
  return content
    .replace(
      `@SlashGroup({
  name: "settings",
  description: "Settings",
  root: "role-tracking",
})
@SlashGroup("settings", "role-tracking")`,
      `@SlashGroup({
  name: "config",
  description: "Role tracking configuration",
  root: "role-tracking",
})
@SlashGroup("config", "role-tracking")`,
    )
    .replace(/@SlashGroup\("settings", "role-tracking"\)/g, '@SlashGroup("config", "role-tracking")')
    .replace(/\/role-tracking settings/g, "/role-tracking config");
}

function extractMethods(classBody, slashNames) {
  const extracted = [];
  const regex = / {2}@Slash\(\{[\s\S]*?name: "([^"]+)"[\s\S]*?\}\)\n {2}async (\w+)\(/g;
  let match;
  const matches = [];
  while ((match = regex.exec(classBody)) !== null) {
    matches.push({ slashName: match[1], methodName: match[2], start: match.index });
  }

  const toRemove = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (!slashNames.has(m.slashName)) continue;
    const end = i + 1 < matches.length ? matches[i + 1].start : classBody.length;
    const block = classBody.slice(m.start, end).replace(/\s+$/, "");
    extracted.push(block);
    toRemove.push({ start: m.start, end });
  }

  let remaining = classBody;
  for (let i = toRemove.length - 1; i >= 0; i--) {
    const { start, end } = toRemove[i];
    remaining = remaining.slice(0, start) + remaining.slice(end);
  }

  return { extracted, remaining };
}

function processFile(filePath, slashNames) {
  let content = fs.readFileSync(filePath, "utf8");
  content = renameConfig(content);

  const classStart = content.indexOf("export class ");
  const classBodyStart = content.indexOf("{", classStart) + 1;
  const classEnd = content.lastIndexOf("\n}");
  const before = content.slice(0, classBodyStart);
  const classBody = content.slice(classBodyStart, classEnd);
  const after = content.slice(classEnd);

  const { extracted, remaining } = extractMethods(classBody, slashNames);
  fs.writeFileSync(filePath, before + remaining + after);
  return extracted;
}

const settingsExtracted = processFile(settingsPath, ACTION_SLASH_NAMES);
const warningsExtracted = processFile(warningsPath, ACTION_SLASH_NAMES);
const allMethods = [...settingsExtracted, ...warningsExtracted];

const actionsHeader = `import {
  Discord,
  Guard,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  CommandInteraction,
  ApplicationCommandOptionType,
  MessageFlags,
  EmbedBuilder,
  Colors,
  Role,
  User,
  AutocompleteInteraction,
  BaseInteraction,
} from "discord.js";
import { Pagination } from "@discordx/pagination";
import { patrolTimer, prisma, roleTrackingManager } from "../../main.js";
import { PermissionNodeGuard } from "../../utility/permissionNodes.js";
import { loggers } from "../../utility/logger.js";
import type { RoleTrackingConfigMap } from "../../managers/roleTracking/roleTrackingManager.js";
import { msToDurationString } from "../../utility/roleTracking/durationParser.js";

@Discord()
@SlashGroup({
  name: "role-tracking",
  description: "Role tracking",
})
@SlashGroup("role-tracking")
@Guard(PermissionNodeGuard("settings.command.role-tracking"))
export class RoleTrackingActionsCommands {
  private async autocompleteTrackedRoles(interaction: AutocompleteInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.respond([]);
      return;
    }

    try {
      const settings = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });

      const config = (settings?.roleTrackingConfig as unknown as RoleTrackingConfigMap) || {};
      const focused = interaction.options.getFocused(true);
      const query = focused.value.toLowerCase();

      const guild = interaction.guild;
      if (!guild) {
        await interaction.respond([]);
        return;
      }

      const choices = [];
      for (const [roleId, roleConfig] of Object.entries(config)) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;

        const roleName = role.name.toLowerCase();
        const configName = roleConfig.roleName.toLowerCase();

        if (roleName.includes(query) || configName.includes(query) || roleId === query) {
          choices.push({
            name: \`\${role.name} (\${roleConfig.roleName})\`,
            value: roleId,
          });
        }
      }

      await interaction.respond(choices.slice(0, 25));
    } catch (error) {
      loggers.bot.error("Error in autocomplete tracked roles", error);
      await interaction.respond([]);
    }
  }

`;

const actionsFooter = "\n}\n";
const actionsContent = actionsHeader + allMethods.join("\n\n") + actionsFooter;
fs.mkdirSync(path.dirname(actionsPath), { recursive: true });
fs.writeFileSync(actionsPath, actionsContent);
console.log(`Extracted ${allMethods.length} action methods to ${actionsPath}`);
