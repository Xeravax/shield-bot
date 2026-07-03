import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
  Role,
} from "discord.js";
import { PermissionNodeGuard } from "../../../utility/permissionNodes.js";
import { patrolTimer, prisma } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";
import { getScheduleExportSettings } from "../../../managers/events/eventScheduleFormatter.js";

@Discord()
@SlashGroup("events", "settings")
@Guard(PermissionNodeGuard("settings.command.events"))
export class SettingsEventsScheduleExportConfigCommand {
  @Slash({
    name: "schedule-export-config",
    description: "Configure role pings and patrol emoji for weekly schedule exports",
  })
  async scheduleExportConfig(
    @SlashOption({
      name: "on-duty-ping-role",
      description: "Role pinged at the top of on-duty schedule posts",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    onDutyPingRole: Role | null,
    @SlashOption({
      name: "off-duty-ping-role-1",
      description: "First role pinged at the top of off-duty schedule posts",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    offDutyPingRole1: Role | null,
    @SlashOption({
      name: "off-duty-ping-role-2",
      description: "Second role pinged at the top of off-duty schedule posts",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    offDutyPingRole2: Role | null,
    @SlashOption({
      name: "patrol-emoji-name",
      description: "Custom emoji name for patrol events (e.g. EventHosts)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    patrolEmojiName: string | null,
    @SlashOption({
      name: "patrol-emoji-id",
      description: "Custom emoji ID for patrol events",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    patrolEmojiId: string | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({
          content: "❌ This command can only be used in a server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const hasUpdate =
        onDutyPingRole !== null ||
        offDutyPingRole1 !== null ||
        offDutyPingRole2 !== null ||
        patrolEmojiName !== null ||
        patrolEmojiId !== null;

      if (!hasUpdate) {
        const settings = await prisma.guildSettings.findUnique({
          where: { guildId: interaction.guildId },
        });
        const exportSettings = getScheduleExportSettings(settings);
        const offDutyRoles = exportSettings.offDutyPingRoleIds ?? [];
        const patrolEmoji =
          exportSettings.patrolEmojiName && exportSettings.patrolEmojiId
            ? `<:${exportSettings.patrolEmojiName}:${exportSettings.patrolEmojiId}>`
            : "*(not set)*";

        await interaction.reply({
          content:
            "**Schedule export config**\n" +
            `• On-duty ping role: ${exportSettings.onDutyPingRoleId ? `<@&${exportSettings.onDutyPingRoleId}>` : "*(not set)*"}\n` +
            `• Off-duty ping roles: ${offDutyRoles.length > 0 ? offDutyRoles.map((id) => `<@&${id}>`).join(" ") : "*(not set)*"}\n` +
            `• Patrol emoji: ${patrolEmoji}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const existing = await prisma.guildSettings.findUnique({
        where: { guildId: interaction.guildId },
      });
      const currentOffDuty = Array.isArray(existing?.eventOffDutyPingRoleIds)
        ? (existing.eventOffDutyPingRoleIds as string[])
        : [];

      const offDutyPingRoleIds = [
        offDutyPingRole1?.id ?? currentOffDuty[0] ?? null,
        offDutyPingRole2?.id ?? currentOffDuty[1] ?? null,
      ].filter((id): id is string => Boolean(id));

      await prisma.guildSettings.upsert({
        where: { guildId: interaction.guildId },
        update: {
          ...(onDutyPingRole ? { eventOnDutyPingRoleId: onDutyPingRole.id } : {}),
          ...(offDutyPingRole1 !== null || offDutyPingRole2 !== null
            ? { eventOffDutyPingRoleIds: offDutyPingRoleIds }
            : {}),
          ...(patrolEmojiName !== null ? { eventPatrolEmojiName: patrolEmojiName || null } : {}),
          ...(patrolEmojiId !== null ? { eventPatrolEmojiId: patrolEmojiId || null } : {}),
        },
        create: {
          guildId: interaction.guildId,
          eventOnDutyPingRoleId: onDutyPingRole?.id ?? null,
          eventOffDutyPingRoleIds: offDutyPingRoleIds,
          eventPatrolEmojiName: patrolEmojiName,
          eventPatrolEmojiId: patrolEmojiId,
        },
      });

      await patrolTimer.logCommandUsage(
        interaction.guildId,
        "settings-events-schedule-export-config",
        interaction.user.id,
      );

      await interaction.reply({
        content: "✅ Schedule export config updated.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error: unknown) {
      loggers.bot.error("Error updating schedule export config", error);
      await interaction.reply({
        content: `❌ Failed to update config: ${error instanceof Error ? error.message : "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
