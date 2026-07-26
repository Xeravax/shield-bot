import { Discord, SlashGroup } from "discordx";

@Discord()
@SlashGroup({
  name: "profile",
  description: "Manage your personal bot settings",
})
export class ProfileRootGroup {}
