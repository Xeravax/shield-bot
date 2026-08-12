import fs from "fs";

const path = "src/commands/settings/promotion/promotion.ts";
let content = fs.readFileSync(path, "utf8");

content = content.replace(
  `@Discord()
@SlashGroup({
  name: "settings",
  description: "Settings",
  root: "patrol",
})
@SlashGroup("settings", "patrol")`,
  `@Discord()
@SlashGroup("patrol", "settings")`,
);

const fnStart = content.indexOf("function formatRuleCooldownLabel");
const fnEnd = content.indexOf("@Discord()", fnStart);
if (fnStart !== -1 && fnEnd !== -1) {
  content = content.slice(0, fnStart) + content.slice(fnEnd);
}

const listNotifStart = content.indexOf('  @Slash({\n    name: "list-notifications"');
const listRulesStart = content.indexOf('  @Slash({\n    name: "list-rules"');
const resetUserStart = content.indexOf('  @Slash({\n    name: "reset-user"');

if (listNotifStart !== -1 && listRulesStart !== -1 && resetUserStart !== -1) {
  const listRulesEnd = content.indexOf("\n  }\n", resetUserStart - 20);
  const before = content.slice(0, listNotifStart);
  const listRules = content.slice(listRulesStart, listRulesEnd + 4);
  content = before + listRules + "\n}\n";
}

content = content.replace(
  'import { Discord, Guard, Slash, SlashChoice, SlashGroup, SlashOption }',
  'import { Discord, Guard, Slash, SlashGroup, SlashOption }',
);
content = content.replace("  GuildMember,\n", "");
content = content.replace("  User,\n", "");
content = content.replace(
  "type { PromotionRule, RuleEligibilityEntry, PromotionEligibilityReport }",
  "type { PromotionRule }",
);
content = content.replace(
  'import { loggers } from "../../../utility/logger.js";\n',
  "",
);

fs.writeFileSync(path, content);
console.log("promotion.ts config split complete");
