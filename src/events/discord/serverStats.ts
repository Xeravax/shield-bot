import { ArgsOf, Discord, On } from "discordx";
import { serverStatsManager } from "../../main.js";

/**
 * Debounced server-stats channel refresh on member/boost/role changes.
 * Cron remains the rate-limit-safe source of truth; these only queue updates.
 */
@Discord()
export class ServerStatsEvents {
  @On({ event: "guildMemberAdd" })
  onGuildMemberAdd([member]: ArgsOf<"guildMemberAdd">): void {
    serverStatsManager.queueRefresh(member.guild.id);
  }

  @On({ event: "guildMemberRemove" })
  onGuildMemberRemove([member]: ArgsOf<"guildMemberRemove">): void {
    serverStatsManager.queueRefresh(member.guild.id);
  }

  @On({ event: "guildMemberUpdate" })
  onGuildMemberUpdate([oldMember, newMember]: ArgsOf<"guildMemberUpdate">): void {
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    const rolesChanged =
      oldRoles.size !== newRoles.size ||
      !oldRoles.every((role) => newRoles.has(role.id));

    const boostChanged =
      Boolean(oldMember.premiumSince) !== Boolean(newMember.premiumSince);

    if (rolesChanged || boostChanged) {
      serverStatsManager.queueRefresh(newMember.guild.id);
    }
  }

  @On({ event: "guildUpdate" })
  onGuildUpdate([oldGuild, newGuild]: ArgsOf<"guildUpdate">): void {
    if (
      oldGuild.memberCount !== newGuild.memberCount ||
      oldGuild.premiumSubscriptionCount !== newGuild.premiumSubscriptionCount
    ) {
      serverStatsManager.queueRefresh(newGuild.id);
    }
  }
}
