import {
  ApplicationCommandOptionType,
  CommandInteraction,
  GuildMember,
  MessageFlags,
  User,
} from "discord.js";
import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import { PermissionNodeGuard } from "../../utility/guards.js";
import { modCaseManager } from "../../main.js";
import { loggers } from "../../utility/logger.js";

/** ECMAScript Date time value limit (±100M days from epoch). */
const SAFE_DATE_MAX_MS = 8.64e15;

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
      const ms = value * pattern.multiplier;
      if (!Number.isFinite(ms) || Date.now() + ms > SAFE_DATE_MAX_MS) {
        return null;
      }
      return ms;
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

async function resolveInvoker(interaction: CommandInteraction): Promise<GuildMember | null> {
  if (!interaction.guild) {
    return null;
  }
  if (interaction.member instanceof GuildMember) {
    return interaction.member;
  }
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

/** Rejects self, guild owner, or targets with equal/higher top role than the invoker. */
function hierarchyBlockReason(
  invoker: GuildMember,
  target: GuildMember,
): string | null {
  if (target.id === invoker.id) {
    return "❌ You cannot moderate yourself.";
  }
  if (target.id === target.guild.ownerId) {
    return "❌ You cannot moderate the server owner.";
  }
  if (
    invoker.id !== invoker.guild.ownerId &&
    target.roles.highest.position >= invoker.roles.highest.position
  ) {
    return "❌ You cannot moderate a member with equal or higher roles.";
  }
  return null;
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
    const invoker = await resolveInvoker(interaction);
    if (!invoker) {
      await interaction.reply({
        content: "❌ Could not resolve your member.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const hierarchyError = hierarchyBlockReason(invoker, member);
    if (hierarchyError) {
      await interaction.reply({
        content: hierarchyError,
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
    try {
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
    } catch (error) {
      loggers.bot.error("Kick failed", error);
      await interaction.editReply({
        content: `❌ Kick failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
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

    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (member) {
      const invoker = await resolveInvoker(interaction);
      if (!invoker) {
        await interaction.reply({
          content: "❌ Could not resolve your member.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const hierarchyError = hierarchyBlockReason(invoker, member);
      if (hierarchyError) {
        await interaction.reply({
          content: hierarchyError,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!member.bannable) {
        await interaction.reply({
          content: "❌ I cannot ban that member.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    modCaseManager.suppressGatewayCase(interaction.guildId!, user.id, ["BAN"]);
    try {
      await interaction.guild!.members.ban(user.id, {
        reason: reason ?? undefined,
        deleteMessageSeconds: (deleteDays ?? 0) * 24 * 60 * 60,
      });
    } catch (error) {
      loggers.bot.error("Ban failed", error);
      await interaction.editReply({
        content: `❌ Ban failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
      return;
    }

    try {
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
      loggers.bot.error("Ban case record failed", error);
      await interaction.editReply({
        content: expiresAt
          ? `✅ Temp-banned ${user} until <t:${Math.floor(expiresAt.getTime() / 1000)}:F> (case log failed to save).`
          : `✅ Banned ${user} (case log failed to save).`,
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

    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (member) {
      const invoker = await resolveInvoker(interaction);
      if (!invoker) {
        await interaction.reply({
          content: "❌ Could not resolve your member.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const hierarchyError = hierarchyBlockReason(invoker, member);
      if (hierarchyError) {
        await interaction.reply({
          content: hierarchyError,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!member.bannable) {
        await interaction.reply({
          content: "❌ I cannot softban that member.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    modCaseManager.suppressGatewayCase(interaction.guildId!, user.id, [
      "BAN",
      "UNBAN",
      "SOFTBAN",
    ]);
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
    modCaseManager.suppressGatewayCase(interaction.guildId!, user.id, ["UNBAN"]);
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
      loggers.bot.error("Unban failed", error);
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
    if (!member) {
      await interaction.reply({
        content: "❌ Member not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const invoker = await resolveInvoker(interaction);
    if (!invoker) {
      await interaction.reply({
        content: "❌ Could not resolve your member.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const hierarchyError = hierarchyBlockReason(invoker, member);
    if (hierarchyError) {
      await interaction.reply({
        content: hierarchyError,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!member.moderatable) {
      await interaction.reply({
        content: "❌ I cannot timeout that member.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const expiresAt = new Date(Date.now() + ms);
    try {
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
    } catch (error) {
      loggers.bot.error("Timeout failed", error);
      await interaction.editReply({
        content: `❌ Timeout failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
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
    try {
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
    } catch (error) {
      loggers.bot.error("Untimeout failed", error);
      await interaction.editReply({
        content: `❌ Untimeout failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
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
    try {
      await modCaseManager.addNote(
        interaction.guildId!,
        user.id,
        interaction.user.id,
        content,
      );
      await interaction.editReply({ content: `✅ Note added for ${user}.` });
    } catch (error) {
      loggers.bot.error("Note creation failed", error);
      await interaction.editReply({
        content: `❌ Note failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
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
      const embed = modCaseManager.buildCaseEmbed(modCase);
      if (embed.data.description && embed.data.description.length > 4096) {
        embed.setDescription(`${embed.data.description.slice(0, 4095)}…`);
      }
      await interaction.editReply({ embeds: [embed] });
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
    const header = `**Cases for ${user}**\n`;
    const lines = cases.map(
      (c) =>
        `#${c.caseNumber} · **${c.type}** · <@${c.moderatorId}> · ${c.reason?.slice(0, 80) || "*no reason*"}`,
    );
    let body = lines.join("\n");
    const maxLen = 2000;
    if (header.length + body.length > maxLen) {
      body = `${body.slice(0, maxLen - header.length - 1)}…`;
    }
    await interaction.editReply({
      content: `${header}${body}`,
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

    try {
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
    } catch (error) {
      loggers.bot.error("Channel lock failed", error);
      await interaction.editReply({
        content: `❌ Lock failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
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

    try {
      await channel.permissionOverwrites.edit(interaction.guild.id, {
        SendMessages: null,
        AddReactions: null,
        CreatePublicThreads: null,
        CreatePrivateThreads: null,
        SendMessagesInThreads: null,
      });

      await modCaseManager.deactivateActiveCases(
        interaction.guildId,
        channel.id,
        "LOCK",
      );

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
    } catch (error) {
      loggers.bot.error("Channel unlock failed", error);
      await interaction.editReply({
        content: `❌ Unlock failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }
}
