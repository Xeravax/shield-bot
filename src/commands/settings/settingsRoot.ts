import { Discord, SlashGroup } from "discordx";
import { descriptionLocalizationsForKey } from "../../i18n/index.js";

@Discord()
// Root settings group definition
@SlashGroup({
  name: "settings",
  description: "Bot configuration and settings commands",
  descriptionLocalizations: descriptionLocalizationsForKey("slash.settings.root"),
})
// Assign subsequent slashes in this class to the root group
export class SettingsRootGroup {}
