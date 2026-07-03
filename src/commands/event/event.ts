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
  GuildMember,
  MessageFlags,
  User,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  Colors,
} from "discord.js";
import { GuildGuard } from "../../utility/guards.js";
import { PermissionNodeGuard, hasNode } from "../../utility/permissionNodes.js";
import { prisma } from "../../main.js";
import { buildTimeAutocompleteChoices } from "../../managers/events/eventTimeParser.js";
import { getUserTimezone } from "../../utility/userPreferences.js";
import { EventDuty, PlannedEventStatus } from "../../generated/prisma/client.js";
import {
  formatScheduleMessage,
  getExportableEvents,
  getPendingEventsForSchedulableWeek,
  formatExportPendingWarning,
  refreshDraftPanel,
  setEventForceOverride,
  cancelPlannedEvent,
  beginEventEditForHost,
  approvePlannedEvent,
  denyPlannedEvent,
  submitEventForApproval,
  runEventValidation,
  DRAFT_PLACEHOLDER_TITLE,
  resolveDraftStartTime,
} from "../../managers/events/eventPlanningManager.js";
import { respondPlannedEventAutocomplete } from "../../managers/events/eventAutocomplete.js";
import { getScheduleExportSettings } from "../../managers/events/eventScheduleFormatter.js";
import { jrHostMissingFullCoHost } from "../../managers/events/eventRules.js";
import {
  defaultDurationMinutes,
  parseDurationOption,
  parseEventTypeOption,
} from "../../managers/events/eventType.js";
import { loggers } from "../../utility/logger.js";

@Discord()
@SlashGroup({
  name: "event",
  description: "Event scheduling commands",
})
@SlashGroup("event")
@Guard(GuildGuard)
export class EventCommands {
  @Slash({
    name: "schedule",
    description: "Schedule a planned event (opens an editable draft panel)",
  })
  @Guard(PermissionNodeGuard("events.command.schedule"))
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
      description: "When the event starts — natural language uses your profile timezone, or a unix timestamp",
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
      description: "Event host (defaults to you)",
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
      description: "Bypass blocking rule failures (requires events.schedule.force)",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    force: boolean | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    const useForce = force === true;
    if (useForce) {
      const member = interaction.member
        ? await interaction.guild!.members.fetch(interaction.user.id).catch(() => null)
        : null;
      if (!member || !(await hasNode(member, "events.schedule.force"))) {
        await interaction.reply({
          content: "❌ You need the `events.schedule.force` permission to use force.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    if (host && host.id !== interaction.user.id) {
      await interaction.reply({
        content:
          "❌ Event drafts can only be created for yourself. You cannot schedule on behalf of another member.",
        flags: MessageFlags.Ephemeral,
      });
      return;
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
      const timezone = await getUserTimezone(interaction.user.id);
      const event = await prisma.plannedEvent.create({
        data: {
          guildId: interaction.guildId,
          title: title?.trim() || DRAFT_PLACEHOLDER_TITLE,
          startTime: resolveDraftStartTime(time, timezone),
          hostId,
          coHostOpen,
          duty: eventDuty,
          eventType,
          durationMinutes,
        },
      });

      if (useForce) {
        setEventForceOverride(event.id, true);
      }

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
    description: "Export approved events for the upcoming week",
  })
  @Guard(PermissionNodeGuard("events.command.export"))
  async export(
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

    const events = await getExportableEvents(interaction.guildId);

    if (events.length === 0) {
      await interaction.editReply({
        content: "ℹ️ No approved, unexported events found for the upcoming week.",
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
        content: `❌ Cannot export — these Jr. Host events need a full Host co-host:\n${blocked.join("\n")}`,
      });
      return;
    }

    const settings = await prisma.guildSettings.findUnique({
      where: { guildId: interaction.guildId },
    });
    const exportSettings = getScheduleExportSettings(settings);
    const pending = await getPendingEventsForSchedulableWeek(interaction.guildId);
    const pendingWarning = formatExportPendingWarning(
      pending,
      interaction.guildId,
      settings?.eventPlanningChannelId,
    );
    const preview = formatScheduleMessage(events, exportSettings);

    const descriptionParts = [];
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
          ? "Events will be locked on confirm. Pending events will be denied. You will receive copy-paste templates."
          : "Exported events are locked. Remaining pending events will be denied on confirm.",
      });
    } else {
      embed.setFooter({
        text: manualPost
          ? "Events will be locked on confirm. You will receive copy-paste templates to post yourself."
          : "Exported events are locked and cannot be edited.",
      });
    }

    const confirmMode = manualPost ? "manual" : "channel";
    const confirm = new ButtonBuilder()
      .setCustomId(`event:export:confirm:${interaction.guildId}:${confirmMode}`)
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
    name: "edit",
    description: "Reopen a pending or denied event for editing (host only)",
  })
  @Guard(GuildGuard)
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

    const result = await beginEventEditForHost(
      eventId,
      interaction.guild,
      interaction.user.id,
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
  @Guard(GuildGuard)
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

    if (interaction.user.id !== event.hostId) {
      await interaction.reply({
        content: "❌ Only the event host can submit this event.",
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

    const { results } = await runEventValidation(event, interaction.guild);
    if (results.some((r) => r.severity === "fail")) {
      await interaction.reply({
        content: "❌ Blocking validation failures must be resolved before submitting.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
  @Guard(GuildGuard)
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

    const member = interaction.member as GuildMember | null;
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
    const member = interaction.member as GuildMember | null;
    const isLead = member ? await hasNode(member, "events.manage.approve") : false;
    await respondPlannedEventAutocomplete(
      interaction,
      [PlannedEventStatus.PENDING, PlannedEventStatus.APPROVED],
      { restrictToCallerHost: true, leadCanSeeAll: true, isLead },
    );
  }

  async autocompleteEditEvent(interaction: AutocompleteInteraction): Promise<void> {
    await respondPlannedEventAutocomplete(
      interaction,
      [PlannedEventStatus.PENDING, PlannedEventStatus.DENIED],
      { restrictToCallerHost: true },
    );
  }

  async autocompleteSubmitEvent(interaction: AutocompleteInteraction): Promise<void> {
    await respondPlannedEventAutocomplete(
      interaction,
      [PlannedEventStatus.DRAFT, PlannedEventStatus.DENIED],
      { restrictToCallerHost: true },
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
    const choices = buildTimeAutocompleteChoices(focused, { timezone });
    await interaction.respond(choices);
  }
}
