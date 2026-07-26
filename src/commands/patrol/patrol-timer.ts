import {
  Discord,
  Slash,
  SlashGroup,
  SlashOption,
  SlashChoice,
  Guard,
} from "discordx";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  GuildMember,
  MessageFlags,
  User,
  AutocompleteInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { patrolTimer } from "../../main.js";
import {
  hasNode,
} from "../../utility/permissionNodes.js";
import { PermissionNodeGuard } from "../../utility/guards.js";
import { prisma } from "../../main.js";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

@Discord()
@SlashGroup({
  name: "patrol",
  description: "Patrol timer",
})
@SlashGroup("patrol")
export class PatrolTimerCommands {
  @Slash({
    name: "current",
    description: "Show tracked users in voice",
  })
  @Guard(PermissionNodeGuard("patrol.command.current"))
  async current(
    @SlashOption({
      name: "ephemeral",
      description: "Ephemeral reply",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    ephemeral: boolean = true,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId || !interaction.guild) {return;}
    const list = await patrolTimer.getCurrentTrackedList(interaction.guildId);
    
    if (list.length === 0) {
      await interaction.reply({
        content: "No users currently tracked.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }
    const lines = list.map(
      (it) => `• <@${it.userId}> — ${msToReadable(it.ms)} — <#${it.channelId}>`,
    );
    await interaction.reply({
      content: lines.join("\n"),
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  @Slash({ name: "top", description: "Show patrol time leaderboard" })
  @Guard(PermissionNodeGuard("patrol.command.top"))
  async top(
    @SlashOption({
      name: "limit",
      description: "Limit",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    @SlashChoice({ name: "10", value: "10" })
    @SlashChoice({ name: "25", value: "25" })
    @SlashChoice({ name: "50", value: "50" })
    @SlashChoice({ name: "100", value: "100" })
    @SlashChoice({ name: "500", value: "500" })
    @SlashChoice({ name: "1000", value: "1000" })
    limit: string | undefined,
    @SlashOption({
      name: "all-time",
      description: "All-time totals",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    allTime: boolean = false,
    @SlashOption({
      name: "year",
      description: "Year",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: function (
        this: PatrolTimerCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteYear(interaction);
      },
    })
    year: string | undefined,
    @SlashOption({
      name: "month",
      description: "Month",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: function (
        this: PatrolTimerCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteMonth(interaction);
      },
    })
    month: string | undefined,
    @SlashOption({
      name: "here",
      description: "Current voice channel only",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    here: boolean | undefined,
    @SlashOption({
      name: "ephemeral",
      description: "Ephemeral reply",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    ephemeral: boolean = true,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {return;}
    const member = interaction.member as GuildMember;
    const now = new Date();
    let rows: Array<{ userId: string; totalMs: bigint | number }>;
    let timeDescription: string | undefined;
    
    if (here) {
      const channelId = member.voice?.channelId;
      if (!channelId) {
        await interaction.reply({
          content: "Join a voice channel first.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }
      if (!interaction.guild) {
        await interaction.reply({
          content: "This command can only be used in a server.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }
      rows = await patrolTimer.getTopForChannel(interaction.guild, channelId);
    } else if (allTime) {
      // Get all-time top users
      rows = await patrolTimer.getTop(
        interaction.guildId,
        limit ? parseInt(limit) : undefined,
      );
      timeDescription = "all-time";
    } else {
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1; // 1-12
      
      const parsed = parseYearMonth(year, month, currentYear, currentMonth, true);
      if (!parsed.valid || parsed.year === undefined) {
        await interaction.reply({
          content: parsed.error ?? "Invalid year or month.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const y = parsed.year;
      const m = parsed.month;
      
      // If month is provided (or defaulted), query by month. Otherwise, query by year.
      if (m !== undefined) {
        rows = await patrolTimer.getTopByMonth(
          interaction.guildId,
          y,
          m,
          limit ? parseInt(limit) : undefined,
        );
        timeDescription = `${MONTH_NAMES[m - 1]} ${y}`;
      } else {
        // Year only - get entire year
        rows = await patrolTimer.getTopByYear(
          interaction.guildId,
          y,
          limit ? parseInt(limit) : undefined,
        );
        timeDescription = `${y}`;
      }
    }
    if (rows.length === 0) {
      await interaction.reply({
        content: "No data.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }
    const lines = rows.map(
      (r: { userId: string; totalMs: bigint | number }, idx: number) =>
        `${idx + 1}. <@${r.userId}> — ${msToReadable(Number(r.totalMs))}`,
    );
    const header = timeDescription ? `**Top users for ${timeDescription}:**\n` : "";
    await interaction.reply({
      content: header + lines.join("\n"),
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  @Slash({
    name: "manage",
    description: "Manage patrol data",
  })
  @Guard(PermissionNodeGuard("patrol.command.manage"))
  async manage(
    @SlashChoice({ name: "Wipe", value: "wipe" })
    @SlashChoice({ name: "Adjust", value: "adjust" })
    @SlashChoice({ name: "Pause Guild", value: "pause-guild" })
    @SlashChoice({ name: "Pause User", value: "pause-user" })
    @SlashChoice({ name: "Unpause Guild", value: "unpause-guild" })
    @SlashChoice({ name: "Unpause User", value: "unpause-user" })
    @SlashOption({
      name: "action",
      description: "Action to perform",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    action: string,
    @SlashOption({
      name: "user",
      description: "Target user",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    user: User | null,
    @SlashOption({
      name: "time",
      description: "Time adjustment (+1h30m)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    time: string | null,
    @SlashOption({
      name: "year",
      description: "Year",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: function (
        this: PatrolTimerCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteYear(interaction);
      },
    })
    year: string | undefined,
    @SlashOption({
      name: "month",
      description: "Month",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: function (
        this: PatrolTimerCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteMonth(interaction);
      },
    })
    month: string | undefined,
    @SlashOption({
      name: "ephemeral",
      description: "Ephemeral reply",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    ephemeral: boolean = true,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {return;}

    // Handle wipe action
    if (action === "wipe") {
      if (!user) {
        await interaction.reply({
          content: "User is required for wipe action.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Create confirmation buttons
      const confirmButton = new ButtonBuilder()
        .setCustomId(`patrol-wipe-confirm:${user.id}:${ephemeral}`)
        .setLabel("Confirm Wipe")
        .setStyle(ButtonStyle.Danger);

      const cancelButton = new ButtonBuilder()
        .setCustomId(`patrol-wipe-cancel:${user.id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        confirmButton,
        cancelButton,
      );

      await interaction.reply({
        content: `⚠️ **Warning**: This will permanently delete all patrol data for <@${user.id}>. This action cannot be undone.\n\nAre you sure you want to proceed?`,
        components: [row],
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    // Handle pause-guild action
    if (action === "pause-guild") {
      const success = await patrolTimer.pauseGuild(interaction.guildId);
      if (!success) {
        await interaction.reply({
          content: "❌ Cannot pause guild time tracking while users have active timers. Please wait for all users to leave tracked voice channels first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await patrolTimer.logCommandUsage(interaction.guildId, action, interaction.user.id);
      await interaction.reply({
        content: "⏸️ Patrol time tracking paused for the entire guild. Time will not accumulate until unpaused.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    // Handle unpause-guild action
    if (action === "unpause-guild") {
      await patrolTimer.unpauseGuild(interaction.guildId);
      await patrolTimer.logCommandUsage(interaction.guildId, action, interaction.user.id);
      await interaction.reply({
        content: "▶️ Patrol time tracking resumed for the entire guild.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    // Handle pause-user action
    if (action === "pause-user") {
      if (!user) {
        await interaction.reply({
          content: "User is required for pause-user action.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const success = await patrolTimer.pauseUser(interaction.guildId, user.id);
      if (!success) {
        await interaction.reply({
          content: `❌ Cannot pause time tracking for <@${user.id}> while they have an active timer. Please wait for them to leave the tracked voice channel first.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await patrolTimer.logCommandUsage(interaction.guildId, action, interaction.user.id, user.id);
      await interaction.reply({
        content: `⏸️ Patrol time tracking paused for <@${user.id}>. Their time will not accumulate until unpaused.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    // Handle unpause-user action
    if (action === "unpause-user") {
      if (!user) {
        await interaction.reply({
          content: "User is required for unpause-user action.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await patrolTimer.unpauseUser(interaction.guildId, user.id);
      await patrolTimer.logCommandUsage(interaction.guildId, action, interaction.user.id, user.id);
      await interaction.reply({
        content: `▶️ Patrol time tracking resumed for <@${user.id}>.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    // Handle adjust action
    if (action === "adjust") {
      if (!user) {
        await interaction.reply({
          content: "User is required for adjust action.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!time) {
        await interaction.reply({
          content: "Time is required for adjust action.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Parse the time string
      const parseResult = parseTimeString(time);
      
      if (!parseResult.valid) {
        await interaction.reply({
          content: `❌ Invalid time format. Use format like: +1h30m, -2h15m30s, +45m\n\nSupported units: h (hours), m (minutes), s (seconds)\nExamples:\n• \`+1h\` - Add 1 hour\n• \`-30m\` - Subtract 30 minutes\n• \`+1h30m45s\` - Add 1 hour, 30 minutes, 45 seconds`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const totalMs = parseResult.milliseconds;

      if (totalMs === 0) {
        await interaction.reply({
          content: "❌ Time adjustment must be non-zero.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Determine year and month
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1; // 1-12
      
      const parsed = parseYearMonth(year, month, currentYear, currentMonth, false);
      if (!parsed.valid || parsed.year === undefined || parsed.month === undefined) {
        await interaction.reply({
          content: `❌ ${parsed.error ?? "Invalid year or month."}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const targetYear = parsed.year;
      const targetMonth = parsed.month;

      await patrolTimer.adjustUserTime(interaction.guildId, user.id, totalMs, targetYear, targetMonth);

      const actionText = totalMs > 0 ? "Added" : "Subtracted";
      const absMs = Math.abs(totalMs);
      const timeStr = `${MONTH_NAMES[targetMonth - 1]} ${targetYear}`;
      const details = `${actionText} ${msToReadable(absMs)} ${totalMs > 0 ? "to" : "from"} patrol time for ${timeStr}`;
      
      await patrolTimer.logCommandUsage(interaction.guildId, action, interaction.user.id, user.id, details);
      
      await interaction.reply({
        content: `${actionText} ${msToReadable(absMs)} ${totalMs > 0 ? "to" : "from"} <@${user.id}>'s patrol time for ${timeStr}.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    await interaction.reply({
      content: "❌ Invalid action. Use 'wipe', 'adjust', 'pause-guild', 'pause-user', 'unpause-guild', or 'unpause-user'.",
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    name: "time",
    description: "Check patrol time",
  })
  @Guard(PermissionNodeGuard("patrol.command.time"))
  async time(
    @SlashOption({
      name: "user",
      description: "User (default: you)",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    user: User | undefined,
    @SlashOption({
      name: "all-time",
      description: "All-time total",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    allTime: boolean = false,
    @SlashOption({
      name: "year",
      description: "Year",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: function (
        this: PatrolTimerCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteYear(interaction);
      },
    })
    year: string | undefined,
    @SlashOption({
      name: "month",
      description: "Month",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: function (
        this: PatrolTimerCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteMonth(interaction);
      },
    })
    month: string | undefined,
    @SlashOption({
      name: "ephemeral",
      description: "Ephemeral reply",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    ephemeralOption: boolean | undefined,
    interaction: CommandInteraction,
  ) {
    if (!interaction.guildId) {return;}
    const member = interaction.member as GuildMember;

    // Check if user is staff
    const canViewOthers = await hasNode(member, "patrol.manage.view-others");

    // Determine if response should be ephemeral
    // Staff can control it, others always get ephemeral
    let shouldBeEphemeral = true;
    if (canViewOthers && ephemeralOption !== undefined) {
      shouldBeEphemeral = ephemeralOption;
    }

    // Determine target user
    let targetUserId = user?.id;
    if (!targetUserId) {
      targetUserId = member.id;
    }

    // Permission check: if checking someone else's time, must be staff or higher
    const isCheckingOwnTime = targetUserId === member.id;
    if (!isCheckingOwnTime) {
      if (!canViewOthers) {
        await interaction.reply({
          content: "You can only check your own patrol time. Staff members can check others' time.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    let total: number;
    let timeDescription: string;

    if (allTime) {
      // Get all-time total
      total = await patrolTimer.getUserTotal(interaction.guildId, targetUserId);
      timeDescription = "all-time";
    } else {
      // Get time for specific month/year (similar to existing user command)
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1; // 1-12
      
      const parsed = parseYearMonth(year, month, currentYear, currentMonth, false);
      if (!parsed.valid || parsed.year === undefined || parsed.month === undefined) {
        await interaction.reply({
          content: parsed.error ?? "Invalid year or month.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const y = parsed.year;
      const m = parsed.month;

      total = await patrolTimer.getUserTotalForMonth(
        interaction.guildId,
        targetUserId,
        y,
        m,
      );
      timeDescription = `${y}, ${MONTH_NAMES[m - 1]}`;
    }

    await interaction.reply({
      content: `<@${targetUserId}> — ${msToReadable(total)} ${timeDescription}.`,
      flags: shouldBeEphemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  // Autocomplete handlers
  async autocompleteYear(interaction: AutocompleteInteraction) {
    if (!interaction.guildId) {
      await interaction.respond([]);
      return;
    }

    const member = interaction.member as GuildMember;
    if (!member) {
      await interaction.respond([]);
      return;
    }

    // Check if user is staff - if not, only show their own data
    const canViewOthers = await hasNode(member, "patrol.manage.view-others");

    let years: Array<{ year: number; userCount: number; totalHours: number }>;

    if (canViewOthers) {
      // Staff can see all years
      years = await (patrolTimer as { getAvailableYears: (guildId: string) => Promise<Array<{ year: number; userCount: number; totalHours: number }>> }).getAvailableYears(interaction.guildId);
    } else {
      // Non-staff can only see years where they have data
      const userRecords = await prisma.voicePatrolMonthlyTime.findMany({
        where: {
          guildId: interaction.guildId,
          userId: member.id,
        },
        select: {
          year: true,
          totalMs: true,
        },
      });

      // Group by year and calculate totals
      const yearMap = new Map<number, { totalMs: bigint }>();
      for (const record of userRecords) {
        if (!yearMap.has(record.year)) {
          yearMap.set(record.year, { totalMs: BigInt(0) });
        }
        const yearData = yearMap.get(record.year);
        if (yearData) {
          yearData.totalMs += record.totalMs;
        }
      }

      // Convert to the expected format
      years = Array.from(yearMap.entries())
        .map(([year, data]) => ({
          year,
          userCount: 1, // Always 1 for personal data
          totalHours: Math.floor(Number(data.totalMs) / 1000 / 60 / 60),
        }))
        .sort((a, b) => b.year - a.year);
    }

    const choices = years.map((y) => ({
      name: canViewOthers
        ? `${y.year} — ${y.userCount} users, ${y.totalHours}h`
        : `${y.year} — ${y.totalHours}h (your time)`,
      value: y.year.toString(),
    }));

    await interaction.respond(choices.slice(0, 25));
  }

  async autocompleteMonth(interaction: AutocompleteInteraction) {
    if (!interaction.guildId) {
      await interaction.respond([]);
      return;
    }

    const member = interaction.member as GuildMember;
    if (!member) {
      await interaction.respond([]);
      return;
    }

    // Get the focused option and the year if provided
    // Get focused option to determine which field is being autocompleted
    void interaction.options.getFocused(true);
    const yearOption = interaction.options.get("year");
    const year = yearOption?.value ? parseInt(yearOption.value as string) : undefined;

    // Check if user is staff - if not, only show their own data
    const canViewOthers = await hasNode(member, "patrol.manage.view-others");

    let months: Array<{ year: number; month: number; userCount: number; totalHours: number }>;

    if (canViewOthers) {
      // Staff can see all months
      months = await (patrolTimer as { getAvailableMonths: (guildId: string, year?: number) => Promise<Array<{ year: number; month: number; userCount: number; totalHours: number }>> }).getAvailableMonths(
        interaction.guildId,
        year,
      );
    } else {
      // Non-staff can only see months where they have data
      const where: { guildId: string; userId: string; year?: number } = {
        guildId: interaction.guildId,
        userId: member.id,
      };
      if (year !== undefined) {
        where.year = year;
      }

      const userRecords = await prisma.voicePatrolMonthlyTime.findMany({
        where,
        select: {
          year: true,
          month: true,
          totalMs: true,
        },
      });

      // Group by year+month and calculate totals
      const monthMap = new Map<string, { year: number; month: number; totalMs: bigint }>();
      for (const record of userRecords) {
        const key = `${record.year}-${record.month}`;
        if (!monthMap.has(key)) {
          monthMap.set(key, {
            year: record.year,
            month: record.month,
            totalMs: BigInt(0),
          });
        }
        const monthData = monthMap.get(key);
        if (monthData) {
          monthData.totalMs += record.totalMs;
        }
      }

      // Convert to the expected format
      months = Array.from(monthMap.values())
        .map((data) => ({
          year: data.year,
          month: data.month,
          userCount: 1, // Always 1 for personal data
          totalHours: Math.floor(Number(data.totalMs) / 1000 / 60 / 60),
        }))
        .sort((a, b) => {
          if (a.year !== b.year) {return b.year - a.year;}
          return b.month - a.month;
        });
    }

    const choices = months.map((m) => ({
      name: canViewOthers
        ? `${MONTH_NAMES[m.month - 1]} ${m.year} — ${m.userCount} users, ${m.totalHours}h`
        : `${MONTH_NAMES[m.month - 1]} ${m.year} — ${m.totalHours}h (your time)`,
      value: m.month.toString(),
    }));

    await interaction.respond(choices.slice(0, 25));
  }

}


function msToReadable(ms: number) {
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const parts: string[] = [];
  if (days) {parts.push(`${days}d`);}
  if (hours) {parts.push(`${hours}h`);}
  if (minutes) {parts.push(`${minutes}m`);}
  if (seconds || parts.length === 0) {parts.push(`${seconds}s`);}
  return parts.join(" ");
}

/**
 * Parse a time string in format: +/-1h2m30s
 * Returns object with valid flag and milliseconds value
 */
function parseTimeString(input: string): { valid: boolean; milliseconds: number } {
  // Trim whitespace
  const str = input.trim();
  
  if (str.length === 0) {
    return { valid: false, milliseconds: 0 };
  }

  // Check for leading +/- sign
  const isNegative = str[0] === '-';
  const isPositive = str[0] === '+';
  
  if (!isNegative && !isPositive) {
    return { valid: false, milliseconds: 0 };
  }

  // Remove the sign
  const timeStr = str.slice(1);
  
  if (timeStr.length === 0) {
    return { valid: false, milliseconds: 0 };
  }

  // Regex to match time components: 1h, 30m, 45s
  const pattern = /(\d+(?:\.\d+)?)(h|m|s)/g;
  const matches = [...timeStr.matchAll(pattern)];
  
  if (matches.length === 0) {
    return { valid: false, milliseconds: 0 };
  }

  // Check if the entire string was matched (no invalid characters)
  const matchedStr = matches.map(m => m[0]).join('');
  if (matchedStr !== timeStr) {
    return { valid: false, milliseconds: 0 };
  }

  let totalSeconds = 0;
  const seen = new Set<string>();

  for (const match of matches) {
    const value = parseFloat(match[1]);
    const unit = match[2];

    // Check for duplicate units
    if (seen.has(unit)) {
      return { valid: false, milliseconds: 0 };
    }
    seen.add(unit);

    // Check for invalid values
    if (isNaN(value) || value < 0) {
      return { valid: false, milliseconds: 0 };
    }

    switch (unit) {
      case 'h':
        totalSeconds += value * 3600;
        break;
      case 'm':
        totalSeconds += value * 60;
        break;
      case 's':
        totalSeconds += value;
        break;
    }
  }

  const milliseconds = totalSeconds * 1000 * (isNegative ? -1 : 1);
  
  return { valid: true, milliseconds };
}

/**
 * Parse and validate year/month parameters with smart inference logic.
 * @param yearStr - Year as string (optional)
 * @param monthStr - Month as string (optional)
 * @param currentYear - Current year for defaults/inference
 * @param currentMonth - Current month (1-12) for defaults/inference
 * @param allowYearOnly - If true, allows month to be undefined when year is provided (for year-only queries)
 * @returns Object with valid flag, parsed values, and error message if invalid
 */
function parseYearMonth(
  yearStr: string | undefined,
  monthStr: string | undefined,
  currentYear: number,
  currentMonth: number,
  allowYearOnly: boolean = false,
): { valid: boolean; year?: number; month?: number; error?: string } {
  if (yearStr) {
    // Year is explicitly provided
    const parsedYear = parseInt(yearStr);
    if (isNaN(parsedYear)) {
      return { valid: false, error: "Invalid year." };
    }

    if (monthStr) {
      // Both year and month provided
      const parsedMonth = parseInt(monthStr);
      if (isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
        return { valid: false, error: "Invalid month. Must be between 1 and 12." };
      }
      return { valid: true, year: parsedYear, month: parsedMonth };
    } else {
      // Year provided but no month
      if (allowYearOnly) {
        // Allow year-only queries (month undefined)
        return { valid: true, year: parsedYear, month: undefined };
      } else {
        // Default to current month when year is provided but month is not
        return { valid: true, year: parsedYear, month: currentMonth };
      }
    }
  } else if (monthStr) {
    // Month is provided but not year - intelligently determine year
    const parsedMonth = parseInt(monthStr);
    if (isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
      return { valid: false, error: "Invalid month. Must be between 1 and 12." };
    }
    // If specified month has already passed or is current month, use current year
    // If specified month is yet to come, use previous year
    const inferredYear = parsedMonth <= currentMonth ? currentYear : currentYear - 1;
    return { valid: true, year: inferredYear, month: parsedMonth };
  } else {
    // Neither year nor month provided - use current month/year
    return { valid: true, year: currentYear, month: currentMonth };
  }
}
