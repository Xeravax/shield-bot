import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import { PermissionNodeGuard } from "../../utility/guards.js";
import { modCaseManager } from "../../main.js";
import { loggers } from "../../utility/logger.js";

/** Supports m/h/d/w for moderation durations (timeout + temp ban). */
export function parseModDurationMs(input: string): number | null {
  const normalized = input.trim().toLowerCase();
  const patterns = [
    { regex: /^(\d+)\s*(?:months?|mo)$/, multiplier: 30 * 24 * 60 * 60 * 1000 },
    { regex: /^(\d+)\s*(?:weeks?|w)$/, multiplier: 7 * 24 * 60 * 60 * 1000 },
    { regex: /^(\d+)\s*(?:days?|d)$/, multiplier: 24 * 60 * 60 * 1000 },
    { regex: /^(\d+)\s*(?:hours?|h)$/, multiplier: 60 * 60 * 1000 },
    { regex: /^(\d+)\s*(?:minutes?|mins?|m)$/, multiplier: 60 * 1000 },
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (match) {
      const value = parseInt(match[1], 10);
      if (value <= 0) {
        return null;
      }
      return value * pattern.multiplier;
    }
  }
  return null;
}

async function requireGuild(interaction: CommandInteraction): Promise<boolean> {
  if (!interaction.guildId || !interaction.guild) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

@Discord()
@SlashGroup({ name: "mod", description: "Moderation commands" })
@SlashGroup("mod")
export class ModCommands {
  @Slash({ name: "warn", description: "Warn a member" })
  @Guard(PermissionNodeGuard("mod.command.warn"))
  async warn(
    @SlashOption({
      name: "user",
      description: "Member to warn",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "reason",
      description: "Reason",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireGuild(interaction))) {
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const modCase = await modCaseManager.createCase({
      guildId: interaction.guildId!,
      type: "WARN",
      targetId: user.id,
      moderatorId: interaction.user.id,
      reason: reason ?? null,
    });
    await interaction.editReply({
      content: `✅ Warned ${user} — case #${modCase.caseNumber}.`,
    });
  }

  @Slash({ name: "kick", description: "Kick a member" })
  @Guard(PermissionNodeGuard("mod.command.kick"))
  async kick(
    @SlashOption({
      name: "user",
      description: "Member to kick",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "reason",
      description: "Reason",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireGuild(interaction))) {
      return;
    }
    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.reply({
        content: "❌ Member not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!member.kickable) {
      await interaction.reply({
        content: "❌ I cannot kick that member.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await member.kick(reason ?? undefined);
    const modCase = await modCaseManager.createCase({
      guildId: interaction.guildId!,
      type: "KICK",
      targetId: user.id,
      moderatorId: interaction.user.id,
      reason: reason ?? null,
      active: false,
    });
    await interaction.editReply({
      content: `✅ Kicked ${user} — case #${modCase.caseNumber}.`,
    });
  }

  @Slash({ name: "ban", description: "Ban a member" })
  @Guard(PermissionNodeGuard("mod.command.ban"))
  async ban(
    @SlashOption({
      name: "user",
      description: "User to ban",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "reason",
      description: "Reason",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | null,
    @SlashOption({
      name: "delete_days",
      description: "Delete message history (0–7 days)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 0,
      maxValue: 7,
    })
    deleteDays: number | null,
    @SlashOption({
      name: "duration",
      description: "Temp ban duration (e.g. 7d, 12h). Omit for permanent.",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    duration: string | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireGuild(interaction))) {
      return;
    }

    let expiresAt: Date | null = null;
    if (duration) {
      const ms = parseModDurationMs(duration);
      if (!ms) {
        await interaction.reply({
          content: "❌ Invalid duration. Use e.g. `12h`, `7d`, `2w`.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      expiresAt = new Date(Date.now() + ms);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await interaction.guild!.members.ban(user.id, {
        reason: reason ?? undefined,
        deleteMessageSeconds: (deleteDays ?? 0) * 24 * 60 * 60,
      });
      const modCase = await modCaseManager.createCase({
        guildId: interaction.guildId!,
        type: "BAN",
        targetId: user.id,
        moderatorId: interaction.user.id,
        reason: reason ?? null,
        expiresAt,
        active: true,
      });
      await interaction.editReply({
        content: expiresAt
          ? `✅ Temp-banned ${user} until <t:${Math.floor(expiresAt.getTime() / 1000)}:F> — case #${modCase.caseNumber}.`
          : `✅ Banned ${user} — case #${modCase.caseNumber}.`,
      });
    } catch (error) {
      loggers.bot.error("Ban failed", error);
      await interaction.editReply({
        content: `❌ Ban failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({ name: "softban", description: "Ban, delete messages, then unban" })
  @Guard(PermissionNodeGuard("mod.command.softban"))
  async softban(
    @SlashOption({
      name: "user",
      description: "User to softban",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "reason",
      description: "Reason",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | null,
    @SlashOption({
      name: "delete_days",
      description: "Delete message history (1–7 days)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 7,
    })
    deleteDays: number | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireGuild(interaction))) {
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await interaction.guild!.members.ban(user.id, {
        reason: reason ?? "Softban",
        deleteMessageSeconds: (deleteDays ?? 1) * 24 * 60 * 60,
      });
      await interaction.guild!.members.unban(user.id, "Softban unban");
      const modCase = await modCaseManager.createCase({
        guildId: interaction.guildId!,
        type: "SOFTBAN",
        targetId: user.id,
        moderatorId: interaction.user.id,
        reason: reason ?? null,
        active: false,
      });
      await interaction.editReply({
        content: `✅ Softbanned ${user} — case #${modCase.caseNumber}.`,
      });
    } catch (error) {
      loggers.bot.error("Softban failed", error);
      await interaction.editReply({
        content: `❌ Softban failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({ name: "unban", description: "Unban a user" })
  @Guard(PermissionNodeGuard("mod.command.unban"))
  async unban(
    @SlashOption({
      name: "user",
      description: "User to unban",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "reason",
      description: "Reason",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireGuild(interaction))) {
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await interaction.guild!.members.unban(user.id, reason ?? undefined);
      const modCase = await modCaseManager.createCase({
        guildId: interaction.guildId!,
        type: "UNBAN",
        targetId: user.id,
        moderatorId: interaction.user.id,
        reason: reason ?? null,
        active: false,
      });
      await interaction.editReply({
        content: `✅ Unbanned ${user} — case #${modCase.caseNumber}.`,
      });
    } catch (error) {
      await interaction.editReply({
        content: `❌ Unban failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  @Slash({ name: "timeout", description: "Timeout a member" })
  @Guard(PermissionNodeGuard("mod.command.timeout"))
  async timeout(
    @SlashOption({
      name: "user",
      description: "Member to timeout",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "duration",
      description: "Duration (e.g. 10m, 1h, 1d). Max 28d.",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    duration: string,
    @SlashOption({
      name: "reason",
      description: "Reason",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireGuild(interaction))) {
      return;
    }
    const ms = parseModDurationMs(duration);
    if (!ms || ms > 28 * 24 * 60 * 60 * 1000) {
      await interaction.reply({
        content: "❌ Invalid duration (max 28d). Use e.g. `10m`, `1h`, `1d`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (!member?.moderatable) {
      await interaction.reply({
        content: "❌ I cannot timeout that member.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const expiresAt = new Date(Date.now() + ms);
    await member.timeout(ms, reason ?? undefined);
    const modCase = await modCaseManager.createCase({
      guildId: interaction.guildId!,
      type: "TIMEOUT",
      targetId: user.id,
      moderatorId: interaction.user.id,
      reason: reason ?? null,
      expiresAt,
    });
    await interaction.editReply({
      content: `✅ Timed out ${user} until <t:${Math.floor(expiresAt.getTime() / 1000)}:F> — case #${modCase.caseNumber}.`,
    });
  }

  @Slash({ name: "untimeout", description: "Remove a member timeout" })
  @Guard(PermissionNodeGuard("mod.command.untimeout"))
  async untimeout(
    @SlashOption({
      name: "user",
      description: "Member to untimeout",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "reason",
      description: "Reason",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireGuild(interaction))) {
      return;
    }
    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (!member?.moderatable) {
      await interaction.reply({
        content: "❌ I cannot modify that member.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await member.timeout(null, reason ?? undefined);
    const modCase = await modCaseManager.createCase({
      guildId: interaction.guildId!,
      type: "UNTIMEOUT",
      targetId: user.id,
      moderatorId: interaction.user.id,
      reason: reason ?? null,
      active: false,
    });
    await interaction.editReply({
      content: `✅ Removed timeout for ${user} — case #${modCase.caseNumber}.`,
    });
  }

  @Slash({ name: "note", description: "Add a private staff note on a user" })
  @Guard(PermissionNodeGuard("mod.command.note"))
  async note(
    @SlashOption({
      name: "user",
      description: "User",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    user: User,
    @SlashOption({
      name: "content",
      description: "Note content",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    content: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireGuild(interaction))) {
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await modCaseManager.addNote(
      interaction.guildId!,
      user.id,
      interaction.user.id,
      content,
    );
    await interaction.editReply({ content: `✅ Note added for ${user}.` });
  }

  @Slash({ name: "cases", description: "Look up moderation cases for a user" })
  @Guard(PermissionNodeGuard("mod.command.cases"))
  async cases(
    @SlashOption({
      name: "user",
      description: "User to look up",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    user: User | null,
    @SlashOption({
      name: "case",
      description: "Case number",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
    })
    caseNumber: number | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireGuild(interaction))) {
      return;
    }
    if (!user && !caseNumber) {
      await interaction.reply({
        content: "❌ Provide a `user` or `case` number.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (caseNumber) {
      const modCase = await modCaseManager.getCaseByNumber(
        interaction.guildId!,
        caseNumber,
      );
      if (!modCase) {
        await interaction.editReply({ content: "❌ Case not found." });
        return;
      }
      await interaction.editReply({
        embeds: [modCaseManager.buildCaseEmbed(modCase)],
      });
      return;
    }

    const cases = await modCaseManager.getCasesForUser(
      interaction.guildId!,
      user!.id,
      15,
    );
    if (cases.length === 0) {
      await interaction.editReply({ content: `ℹ️ No cases for ${user}.` });
      return;
    }
    const lines = cases.map(
      (c) =>
        `#${c.caseNumber} · **${c.type}** · <@${c.moderatorId}> · ${c.reason?.slice(0, 80) || "*no reason*"}`,
    );
    await interaction.editReply({
      content: `**Cases for ${user}**\n${lines.join("\n")}`,
    });
  }

  @Slash({ name: "modlogs", description: "Alias of /mod cases" })
  @Guard(PermissionNodeGuard("mod.command.cases"))
  async modlogs(
    @SlashOption({
      name: "user",
      description: "User to look up",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    user: User | null,
    @SlashOption({
      name: "case",
      description: "Case number",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
    })
    caseNumber: number | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    await this.cases(user, caseNumber, interaction);
  }

  @Slash({ name: "reason", description: "Edit a case reason" })
  @Guard(PermissionNodeGuard("mod.command.reason"))
  async reason(
    @SlashOption({
      name: "case",
      description: "Case number",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      minValue: 1,
    })
    caseNumber: number,
    @SlashOption({
      name: "reason",
      description: "New reason",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    reason: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!(await requireGuild(interaction))) {
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await modCaseManager.updateReason(
      interaction.guildId!,
      caseNumber,
      reason,
    );
    if (!result.success) {
      await interaction.editReply({ content: `❌ ${result.error}` });
      return;
    }
    await interaction.editReply({
      content: `✅ Updated reason for case #${caseNumber}.`,
    });
  }
}

@Discord()
@SlashGroup({ name: "channel", description: "Channel moderation" })
@SlashGroup("channel")
export class ChannelLockCommands {
  @Slash({ name: "lock", description: "Deny @everyone Send Messages in this channel" })
  @Guard(PermissionNodeGuard("mod.command.lock"))
  async lock(
    @SlashOption({
      name: "reason",
      description: "Reason",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId || !interaction.guild || !interaction.channel) {
      await interaction.reply({
        content: "❌ Server channel only.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!interaction.channel.isTextBased() || interaction.channel.isDMBased()) {
      await interaction.reply({
        content: "❌ Text channel only.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.channel;
    if (!("permissionOverwrites" in channel)) {
      await interaction.editReply({ content: "❌ Cannot lock this channel." });
      return;
    }

    await channel.permissionOverwrites.edit(interaction.guild.id, {
      SendMessages: false,
      AddReactions: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
      SendMessagesInThreads: false,
    });

    const modCase = await modCaseManager.createCase({
      guildId: interaction.guildId,
      type: "LOCK",
      targetId: channel.id,
      moderatorId: interaction.user.id,
      reason: reason ?? null,
      active: true,
    });

    await interaction.editReply({
      content: `✅ Channel locked — case #${modCase.caseNumber}.`,
    });
    await channel.send({
      content: `🔒 Channel locked by ${interaction.user}.${reason ? ` Reason: ${reason}` : ""}`,
    }).catch(() => undefined);
  }

  @Slash({ name: "unlock", description: "Restore @everyone Send Messages in this channel" })
  @Guard(PermissionNodeGuard("mod.command.lock"))
  async unlock(
    @SlashOption({
      name: "reason",
      description: "Reason",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId || !interaction.guild || !interaction.channel) {
      await interaction.reply({
        content: "❌ Server channel only.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!interaction.channel.isTextBased() || interaction.channel.isDMBased()) {
      await interaction.reply({
        content: "❌ Text channel only.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.channel;
    if (!("permissionOverwrites" in channel)) {
      await interaction.editReply({ content: "❌ Cannot unlock this channel." });
      return;
    }

    await channel.permissionOverwrites.edit(interaction.guild.id, {
      SendMessages: null,
      AddReactions: null,
      CreatePublicThreads: null,
      CreatePrivateThreads: null,
      SendMessagesInThreads: null,
    });

    const modCase = await modCaseManager.createCase({
      guildId: interaction.guildId,
      type: "UNLOCK",
      targetId: channel.id,
      moderatorId: interaction.user.id,
      reason: reason ?? null,
      active: false,
    });

    await interaction.editReply({
      content: `✅ Channel unlocked — case #${modCase.caseNumber}.`,
    });
    await channel.send({
      content: `🔓 Channel unlocked by ${interaction.user}.${reason ? ` Reason: ${reason}` : ""}`,
    }).catch(() => undefined);
  }
}
