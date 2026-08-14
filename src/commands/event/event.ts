import {
  Discord,
  Guard,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  CommandInteraction,
  MessageFlags,
  User,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  Colors,
} from "discord.js";
import {
  GuildGuard,
  RequireTimezoneGuard,
  resolveGuildMember,
} from "../../utility/guards.js";
import {
  PermissionNodeGuard,
  PermissionNodeGuardAny,
  hasNode,
} from "../../utility/permissionNodes.js";
import { prisma } from "../../main.js";
import { buildTimeAutocompleteChoices } from "../../managers/events/eventTimeParser.js";
import { getUserTimezone } from "../../utility/userPreferences.js";
import { EventDuty, PlannedEventStatus } from "../../generated/prisma/client.js";
import {
  formatScheduleMessage,
  getExportableEvents,
  getPendingEventsForWeek,
  formatExportPendingWarning,
  refreshDraftPanel,
  cancelPlannedEvent,
  beginEventEditForHost,
  approvePlannedEvent,
  denyPlannedEvent,
  submitEventForApproval,
  runEventValidation,
  canManageEventDraft,
  DRAFT_PLACEHOLDER_TITLE,
  resolveDraftStartTime,
  resolveExportWeekRange,
  isExportedEventInCurrentWeek,
} from "../../managers/events/eventPlanningManager.js";
import {
  filterEventsByAutocompleteQuery,
  formatEventAutocompleteLabel,
  resolveHostLabels,
  respondPlannedEventAutocomplete,
} from "../../managers/events/eventAutocomplete.js";
import {
  getScheduleExportSettings,
  rewriteAnnouncementTimestampsToFull,
} from "../../managers/events/eventScheduleFormatter.js";
import { jrHostMissingFullCoHost } from "../../managers/events/eventRules.js";
import {
  defaultDurationMinutes,
  parseDurationOption,
  parseEventTypeOption,
} from "../../managers/events/eventType.js";
import { normalizeEventTitle } from "../../managers/events/eventDraftDefaults.js";
import type { ExportWeekChoice } from "../../managers/events/eventWeek.js";
import { getCurrentEventWeekRange } from "../../managers/events/eventWeek.js";
import { parseDiscordMessageLink } from "../../utility/generalUtils.js";
import { loggers } from "../../utility/logger.js";
import {
  getGuildCalendarFeedUrl,
  getHostCalendarFeedUrl,
} from "../../managers/events/discordEventCalendarFeed.js";

@Discord()
@SlashGroup({
  name: "event",
  description: "Event scheduling commands",
})
@SlashGroup("event")
@Guard(GuildGuard)
export class EventCalendarCommand {
  @Slash({
    name: "calendar",
    description:
      "Get Google Calendar / iCal links for all Shield events and your hosted events",
  })
  @Guard(PermissionNodeGuard("events.command.calendar"))
  async calendar(interaction: CommandInteraction): Promise<void> {
    // GuildGuard ensures guildId is present
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const guildId = interaction.guildId!;

    const guildUrl = getGuildCalendarFeedUrl(guildId);
    const hostUrl = getHostCalendarFeedUrl(
      guildId,
      interaction.user.id,
    );
    await interaction.reply({
      content:
        `📅 **Calendar subscribe links**\n\n` +
        `**All Shield events** (Discord Events tab)\n` +
        `\`${guildUrl}\`\n\n` +
        `**Your hosted events** (pending + approved, where you are the host)\n` +
        `\`${hostUrl}\`\n\n` +
        `Add each as a separate calendar in Google Calendar → Other calendars → From URL.\n` +
        `Google refreshes subscribed calendars on its own schedule (often hours).`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

@Discord()
@SlashGroup("event")
@Guard(GuildGuard)
export class EventCommands {
  @Slash({
    name: "schedule",
    description: "Schedule a planned event (opens an editable draft panel)",
  })
  @Guard(PermissionNodeGuard("events.command.schedule"), RequireTimezoneGuard)
  async schedule(
    @SlashOption({
      name: "title",
      description: "Event title",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 200,
    })
    title: string | null,
    @SlashOption({
      name: "time",
      description: "When the event starts - natural language uses your profile timezone, or a unix timestamp",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: function (
        this: EventCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteTime(interaction);
      },
    })
    time: string | null,
    @SlashChoice({ name: "On-duty", value: "onduty" })
    @SlashChoice({ name: "Off-duty", value: "offduty" })
    @SlashOption({
      name: "duty",
      description: "On-duty or off-duty event",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    duty: string | null,
    @SlashOption({
      name: "host",
      description:
        "Event host (defaults to you; requires events.schedule.behalf to set another member)",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    host: User | null,
    @SlashChoice({ name: "Open", value: "open" })
    @SlashChoice({ name: "Closed", value: "closed" })
    @SlashOption({
      name: "co-host-mode",
      description: "Whether co-host requests are open",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    coHostMode: string | null,
    @SlashChoice({ name: "Auto (from title)", value: "auto" })
    @SlashChoice({ name: "Patrol", value: "patrol" })
    @SlashChoice({ name: "Game", value: "game" })
    @SlashChoice({ name: "Special", value: "special" })
    @SlashChoice({ name: "Recruitment", value: "recruitment" })
    @SlashChoice({ name: "Other", value: "other" })
    @SlashOption({
      name: "type",
      description: "Event type override (takes priority over title inference; use Auto to infer from title)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    eventTypeOption: string | null,
    @SlashChoice({ name: "1 hour", value: 60 })
    @SlashChoice({ name: "2 hours", value: 120 })
    @SlashChoice({ name: "3 hours", value: 180 })
    @SlashOption({
      name: "duration",
      description: "Event duration (on-duty: 2h/3h, off-duty: 1h/2h)",
      type: ApplicationCommandOptionType.Number,
      required: false,
    })
    durationOption: number | null,
    @SlashOption({
      name: "force",
      description: "Bypass week window and other blocking rules (requires events.schedule.force)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    force: boolean | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    const member = interaction.member && interaction.guild
      ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
      : null;

    const useForce = force === true;
    if (useForce) {
      if (!member || !(await hasNode(member, "events.schedule.force"))) {
        await interaction.reply({
          content: "❌ You need the `events.schedule.force` permission to use force.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const schedulingForOther = Boolean(host && host.id !== interaction.user.id);
    if (schedulingForOther) {
      if (!member || !(await hasNode(member, "events.schedule.behalf"))) {
        await interaction.reply({
          content:
            "❌ You need the `events.schedule.behalf` permission to schedule on behalf of another member.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const hostId = host?.id ?? interaction.user.id;
    const coHostOpen = coHostMode === "open";
    const eventDuty = duty === "offduty" ? EventDuty.OFF_DUTY : EventDuty.ON_DUTY;
    const eventType = parseEventTypeOption(eventTypeOption);
    const durationMinutes = durationOption
      ? parseDurationOption(durationOption, eventDuty)
      : defaultDurationMinutes(eventDuty);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const timezone = await getUserTimezone(hostId);
      const event = await prisma.plannedEvent.create({
        data: {
          guildId: interaction.guildId,
          title: title?.trim()
            ? normalizeEventTitle(title)
            : DRAFT_PLACEHOLDER_TITLE,
          startTime: resolveDraftStartTime(time, timezone, {
            enforceWeek: !useForce,
          }),
          hostId,
          coHostOpen,
          duty: eventDuty,
          eventType,
          durationMinutes,
          forceOverride: useForce,
        },
      });

      const { embed, components } = await refreshDraftPanel(
        event.id,
        interaction.guild,
      );
      await interaction.editReply({ embeds: [embed], components });
    } catch (error) {
      loggers.bot.error("Error creating event draft", error);
      await interaction.editReply({
        content: "❌ Failed to create event draft.",
      });
    }
  }

  @Slash({
    name: "export",
    description: "Export approved events for a selected event week",
  })
  @Guard(PermissionNodeGuard("events.command.export"))
  async export(
    @SlashChoice({ name: "Auto (first week with events)", value: "auto" })
    @SlashChoice({ name: "Current week", value: "current" })
    @SlashChoice({ name: "Previous week", value: "previous" })
    @SlashChoice({ name: "Next week", value: "next" })
    @SlashOption({
      name: "week",
      description:
        "Which Tue–Mon event week to export (default: auto - current, then previous, then next)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    weekOption: string | null,
    @SlashOption({
      name: "ephemeral",
      description:
        "If true (default), sends schedule templates for you to copy-paste instead of posting via the bot",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    ephemeral: boolean | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const manualPost = ephemeral !== false;
    const weekChoice = (weekOption ?? "auto") as ExportWeekChoice;
    const weekRange = await resolveExportWeekRange(
      interaction.guildId,
      weekChoice,
    );

    const events = await getExportableEvents(interaction.guildId, weekRange);

    if (events.length === 0) {
      await interaction.editReply({
        content: `ℹ️ No approved, unexported events found for **${weekRange.label}** (${weekRange.choice}).`,
      });
      return;
    }

    const guild = interaction.guild;
    const blocked: string[] = [];
    if (guild) {
      for (const e of events) {
        if (await jrHostMissingFullCoHost(guild, e.hostId, e.coHostId)) {
          blocked.push(`• #${e.id} **${e.title}**`);
        }
      }
    }
    if (blocked.length > 0) {
      await interaction.editReply({
        content: `❌ Cannot export - these Jr. Host events need a full Host co-host:\n${blocked.join("\n")}`,
      });
      return;
    }

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: interaction.guildId },
    });
    const exportSettings = getScheduleExportSettings(settings);
    const pending = await getPendingEventsForWeek(
      interaction.guildId,
      weekRange.start,
      weekRange.end,
    );
    const pendingWarning = formatExportPendingWarning(
      pending,
      interaction.guildId,
      settings?.eventPlanningChannelId,
    );
    const preview = formatScheduleMessage(
      events,
      exportSettings,
      interaction.guildId,
    );

    const descriptionParts = [
      `**Week:** ${weekRange.label} (\`${weekRange.choice}\`)`,
      "",
    ];
    if (pendingWarning) {
      descriptionParts.push(pendingWarning, "", "---", "");
    }
    descriptionParts.push(preview);
    const description = descriptionParts.join("\n").slice(0, 4000);

    const embed = new EmbedBuilder()
      .setTitle(manualPost ? "Export weekly schedule (manual post)?" : "Export weekly schedule?")
      .setDescription(description)
      .setColor(Colors.Orange);

    if (pending.length > 0) {
      embed.setFooter({
        text: manualPost
          ? "Events get Discord scheduled events on confirm. Pending events will be denied. You will receive copy-paste templates. Current-week exports remain editable."
          : "Events get Discord scheduled events on confirm. Remaining pending events will be denied. Current-week exports remain editable.",
      });
    } else {
      embed.setFooter({
        text: manualPost
          ? "Discord scheduled events will be created. You will receive copy-paste templates. Current-week exports remain editable."
          : "Discord scheduled events will be created. Current-week exported events can still be edited if adjustments are needed.",
      });
    }

    const confirmMode = manualPost ? "manual" : "channel";
    const weekStartUnix = Math.floor(weekRange.start.getTime() / 1000);
    const confirm = new ButtonBuilder()
      .setCustomId(
        `event:export:confirm:${interaction.guildId}:${confirmMode}:${weekStartUnix}`,
      )
      .setLabel("Confirm export")
      .setStyle(ButtonStyle.Success);
    const cancel = new ButtonBuilder()
      .setCustomId("event:export:cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirm, cancel);

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  }

  @Slash({
    name: "edit-announcement",
    description:
      "Update a posted schedule announcement to use full date/time timestamps",
  })
  @Guard(
    PermissionNodeGuardAny(
      "events.command.edit-announcement",
      "events.command.export",
    ),
  )
  async editAnnouncement(
    @SlashOption({
      name: "message",
      description: "Discord message link to the announcement",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    messageLink: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      return;
    }

    const parsed = parseDiscordMessageLink(messageLink);
    if (!parsed) {
      await interaction.reply({
        content:
          "❌ Invalid message link. Paste a Discord message link like `https://discord.com/channels/.../.../...`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (parsed.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "❌ That message is from a different server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const channel = await interaction.guild.channels.fetch(parsed.channelId);
      if (!channel?.isTextBased() || channel.isDMBased()) {
        await interaction.editReply({
          content: "❌ Could not find that channel, or it is not a text channel.",
        });
        return;
      }

      const message = await channel.messages.fetch(parsed.messageId);
      if (message.author.id !== interaction.client.user?.id) {
        await interaction.editReply({
          content:
            "❌ I can only edit announcements I posted. For manual posts, replace timestamps with `<t:unix:F>` yourself.",
        });
        return;
      }

      const currentContent = message.content ?? "";
      const updatedContent = rewriteAnnouncementTimestampsToFull(currentContent);
      if (updatedContent === currentContent) {
        await interaction.editReply({
          content: `ℹ️ Announcement already uses full timestamps: ${message.url}`,
        });
        return;
      }

      await message.edit({ content: updatedContent });
      await interaction.editReply({
        content: `✅ Updated announcement to full date/time timestamps: ${message.url}`,
      });
    } catch (error) {
      loggers.bot.error("Error updating announcement timestamps", error);
      await interaction.editReply({
        content: "❌ Failed to update that announcement. Check the link and my channel permissions.",
      });
    }
  }

  @Slash({
    name: "edit",
    description:
      "Edit a pending/denied event, or a current-week exported event",
  })
  @Guard(PermissionNodeGuard("events.command.edit"))
  async edit(
    @SlashOption({
      name: "event",
      description: "The event to edit",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      autocomplete: function (
        this: EventCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteEditEvent(interaction);
      },
    })
    eventId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = await resolveGuildMember(interaction);
    const result = await beginEventEditForHost(
      eventId,
      interaction.guild,
      interaction.user.id,
      member,
    );
    if (!result.success) {
      await interaction.editReply({ content: `❌ ${result.error}` });
      return;
    }

    const { embed, components } = await refreshDraftPanel(eventId, interaction.guild);
    await interaction.editReply({ embeds: [embed], components });
  }

  @Slash({
    name: "submit",
    description: "Submit a draft event for approval (host only)",
  })
  @Guard(PermissionNodeGuard("events.command.submit"))
  async submit(
    @SlashOption({
      name: "event",
      description: "The draft event to submit",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      autocomplete: function (
        this: EventCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteSubmitEvent(interaction);
      },
    })
    eventId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      return;
    }

    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "❌ Event not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await resolveGuildMember(interaction);
    if (
      !(await canManageEventDraft(interaction.user.id, member, event.hostId))
    ) {
      await interaction.reply({
        content:
          "❌ Only the event host (or someone with `events.schedule.behalf`) can submit this event.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      event.status !== PlannedEventStatus.DRAFT &&
      event.status !== PlannedEventStatus.DENIED
    ) {
      await interaction.reply({
        content: "❌ Only draft or denied events can be submitted.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { results } = await runEventValidation(event, interaction.guild);
    if (results.some((r) => r.severity === "fail")) {
      await interaction.editReply({
        content: "❌ Blocking validation failures must be resolved before submitting.",
      });
      return;
    }

    const result = await submitEventForApproval(eventId, interaction.guild);
    if (!result.success) {
      await interaction.editReply({ content: `❌ ${result.error}` });
      return;
    }

    await interaction.editReply({
      content: `✅ **${event.title}** submitted for approval. Check the planning channel for updates.`,
    });
  }

  @Slash({
    name: "approve",
    description: "Approve a pending event (event leads only)",
  })
  @Guard(PermissionNodeGuard("events.manage.approve"))
  async approve(
    @SlashOption({
      name: "event",
      description: "The pending event to approve",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      autocomplete: function (
        this: EventCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteApproveEvent(interaction);
      },
    })
    eventId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await approvePlannedEvent(
      eventId,
      interaction.user.id,
      interaction.guild,
    );
    if (!result.success) {
      await interaction.editReply({ content: `❌ ${result.error}` });
      return;
    }

    await interaction.editReply({ content: "✅ Event approved." });
  }

  @Slash({
    name: "deny",
    description: "Deny a pending event (event leads only)",
  })
  @Guard(PermissionNodeGuard("events.manage.approve"))
  async deny(
    @SlashOption({
      name: "event",
      description: "The pending event to deny",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      autocomplete: function (
        this: EventCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteApproveEvent(interaction);
      },
    })
    eventId: number,
    @SlashOption({
      name: "reason",
      description: "Why the event is being denied",
      type: ApplicationCommandOptionType.String,
      required: true,
      maxLength: 1000,
    })
    reason: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await denyPlannedEvent(
      eventId,
      interaction.user.id,
      reason.trim(),
      interaction.guild,
    );
    if (!result.success) {
      await interaction.editReply({ content: `❌ ${result.error}` });
      return;
    }

    await interaction.editReply({ content: "✅ Event denied." });
  }

  @Slash({
    name: "cancel",
    description:
      "Cancel a pending or approved event and remove it from the host's weekly quota",
  })
  @Guard(
    PermissionNodeGuardAny(
      "events.command.cancel",
      "events.manage.approve",
    ),
  )
  async cancel(
    @SlashOption({
      name: "event",
      description: "The event to cancel",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      autocomplete: function (
        this: EventCommands,
        interaction: AutocompleteInteraction,
      ) {
        return this.autocompleteCancelEvent(interaction);
      },
    })
    eventId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId || !interaction.guild) {
      return;
    }

    const event = await prisma.plannedEvent.findUnique({ where: { id: eventId } });
    if (!event || event.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "❌ Event not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await resolveGuildMember(interaction);
    const isHost = interaction.user.id === event.hostId;
    const isLead = member ? await hasNode(member, "events.manage.approve") : false;
    if (!isHost && !isLead) {
      await interaction.reply({
        content: "❌ Only the event host or event leads can cancel this event.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await cancelPlannedEvent(
      eventId,
      interaction.guild,
      interaction.user.id,
    );

    if (!result.success) {
      await interaction.editReply({ content: `❌ ${result.error}` });
      return;
    }

    await interaction.editReply({
      content: `✅ **${event.title}** (#${event.id}) cancelled. It no longer counts toward <@${event.hostId}>'s weekly event limit.`,
    });
  }

  async autocompleteCancelEvent(interaction: AutocompleteInteraction): Promise<void> {
    const member = await resolveGuildMember(interaction);
    const isLead = member ? await hasNode(member, "events.manage.approve") : false;
    await respondPlannedEventAutocomplete(
      interaction,
      [PlannedEventStatus.PENDING, PlannedEventStatus.APPROVED],
      { restrictToCallerHost: true, leadCanSeeAll: true, isLead },
    );
  }

  async autocompleteEditEvent(interaction: AutocompleteInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.respond([]);
      return;
    }

    const member = await resolveGuildMember(interaction);
    const canBehalf = member
      ? await hasNode(member, "events.schedule.behalf")
      : false;
    const isLead = member
      ? await hasNode(member, "events.manage.approve")
      : false;
    const restrict = !(canBehalf || isLead);
    const week = getCurrentEventWeekRange();

    const events = await prisma.plannedEvent.findMany({
      where: {
        guildId: interaction.guildId,
        OR: [
          {
            status: {
              in: [PlannedEventStatus.PENDING, PlannedEventStatus.DENIED],
            },
            ...(restrict ? { hostId: interaction.user.id } : {}),
          },
          {
            status: PlannedEventStatus.APPROVED,
            discordEventId: { not: null },
            startTime: { gte: week.start, lt: week.end },
            ...(restrict ? { hostId: interaction.user.id } : {}),
          },
        ],
      },
      orderBy: { startTime: "asc" },
    });

    const editable = events.filter(
      (e) =>
        e.status === PlannedEventStatus.PENDING ||
        e.status === PlannedEventStatus.DENIED ||
        isExportedEventInCurrentWeek(e),
    );

    const focused = interaction.options.getFocused();
    const hostLabels = await resolveHostLabels(
      interaction.guild,
      editable.map((e) => e.hostId),
    );
    const filtered = filterEventsByAutocompleteQuery(editable, focused, hostLabels);
    const sorted = [...filtered].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    );

    await interaction.respond(
      sorted.slice(0, 25).map((event) => ({
        name: formatEventAutocompleteLabel(
          event,
          hostLabels.get(event.hostId) ?? "Unknown host",
        ),
        value: event.id,
      })),
    );
  }

  async autocompleteSubmitEvent(interaction: AutocompleteInteraction): Promise<void> {
    const member = await resolveGuildMember(interaction);
    const canBehalf = member
      ? await hasNode(member, "events.schedule.behalf")
      : false;
    await respondPlannedEventAutocomplete(
      interaction,
      [PlannedEventStatus.DRAFT, PlannedEventStatus.DENIED],
      {
        restrictToCallerHost: true,
        leadCanSeeAll: true,
        isLead: canBehalf,
      },
    );
  }

  async autocompleteApproveEvent(interaction: AutocompleteInteraction): Promise<void> {
    await respondPlannedEventAutocomplete(
      interaction,
      [PlannedEventStatus.PENDING],
    );
  }

  async autocompleteTime(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused();
    const timezone = await getUserTimezone(interaction.user.id);
    const force = interaction.options.getBoolean("force") === true;
    const choices = buildTimeAutocompleteChoices(focused, {
      timezone,
      enforceWeek: !force,
    });
    await interaction.respond(choices);
  }
}
