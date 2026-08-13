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
  ChannelType,
  CommandInteraction,
  GuildBasedChannel,
  MessageFlags,
  Role,
  type SendableChannels,
} from "discord.js";
import { GuildGuard } from "../../utility/guards.js";
import { PermissionNodeGuard } from "../../utility/permissionNodes.js";
import { patrolTimer } from "../../main.js";
import { loggers } from "../../utility/logger.js";
import { optRolePanelManager } from "../../managers/optRoles/optRolePanelManager.js";
import {
  OPT_ROLE_PRESET_CHOICES,
  buildCustomOptRolePanel,
  getOptRoleEligibilityError,
  getOptRolePreset,
  parseOptRoleEmoji,
  type OptRoleButton,
  type OptRolePresetKey,
} from "../../managers/optRoles/optRolePanel.js";

type RoleSlot = {
  role: Role | null | undefined;
  emoji: string | null | undefined;
  label: string | null | undefined;
};

function resolvePostChannel(
  channel: GuildBasedChannel | null,
  interaction: CommandInteraction,
): SendableChannels | null {
  const target = channel ?? interaction.channel;
  if (!target || !("send" in target) || !target.isTextBased() || target.isDMBased()) {
    return null;
  }
  return target;
}

function collectCustomButtons(slots: RoleSlot[]): { ok: true; buttons: OptRoleButton[] } | { ok: false; message: string } {
  const buttons: OptRoleButton[] = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const index = i + 1;
    const hasAny = Boolean(slot.role || slot.emoji || slot.label);

    if (!hasAny) {
      continue;
    }

    if (!slot.role || !slot.emoji || !slot.label) {
      return {
        ok: false,
        message: `❌ Role ${index} needs **role-${index}**, **emoji-${index}**, and **label-${index}** together.`,
      };
    }

    const parsedEmoji = parseOptRoleEmoji(slot.emoji);
    if (!parsedEmoji) {
      return {
        ok: false,
        message: `❌ Could not parse emoji ${index}. Use a custom emoji like \`<:name:id>\` or a unicode emoji such as 🎥.`,
      };
    }

    const label = slot.label.trim();
    if (label.length === 0 || label.length > 80) {
      return {
        ok: false,
        message: `❌ Label ${index} must be between 1 and 80 characters.`,
      };
    }

    const eligibilityError = getOptRoleEligibilityError(slot.role);
    if (eligibilityError) {
      return {
        ok: false,
        message: `❌ Role ${index} (${slot.role.name}) cannot be used: ${eligibilityError.replace(/^❌\s*/, "")}`,
      };
    }

    buttons.push({
      roleId: slot.role.id,
      label,
      emoji: parsedEmoji,
      hint: `${slot.role} - click to add or remove this role.`,
    });
  }

  if (buttons.length === 0) {
    return { ok: false, message: "❌ Add at least one role, emoji, and label." };
  }

  return { ok: true, buttons };
}

@Discord()
@SlashGroup({
  name: "opt-roles",
  description: "Post button-based opt-in role panels",
})
@SlashGroup("opt-roles")
@Guard(GuildGuard)
export class OptRolesCommands {
  @Slash({
    name: "post",
    description: "Post a SHIELD opt-in role panel in this channel",
  })
  @Guard(PermissionNodeGuard("opt-roles.command.post"))
  async post(
    @SlashChoice(...OPT_ROLE_PRESET_CHOICES)
    @SlashOption({
      name: "preset",
      description: "Which existing Dyno panel to recreate",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    preset: OptRolePresetKey,
    @SlashOption({
      name: "channel",
      description: "Channel to post in (defaults to the current channel)",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildVoice,
      ],
      required: false,
    })
    channel: GuildBasedChannel | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    const panel = getOptRolePreset(preset);
    if (!panel) {
      await interaction.reply({
        content: "❌ Unknown preset.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = resolvePostChannel(channel, interaction);
    if (!target) {
      await interaction.reply({
        content: "❌ Run this in a server text channel, or pass a text channel to post in.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      await optRolePanelManager.post(target, panel);

      try {
        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "opt-roles-post",
          interaction.user.id,
          undefined,
          `${preset} in ${target.id}`,
        );
      } catch (logError) {
        loggers.bot.warn("Failed to log opt-roles post", logError);
      }

      await interaction.editReply({
        content: `✅ Posted the **${preset}** opt-in panel in ${target}. You can delete the old Dyno message afterward.`,
      });
    } catch (error) {
      loggers.bot.error("opt-roles post command error", error);
      await interaction.editReply({
        content:
          "❌ Failed to post the panel. Check that I can send messages and use external emojis in that channel.",
      });
    }
  }

  @Slash({
    name: "custom",
    description: "Post a custom opt-in panel with up to 5 role buttons",
  })
  @Guard(PermissionNodeGuard("opt-roles.command.post"))
  async custom(
    @SlashOption({
      name: "description",
      description: "Panel text shown above the buttons",
      type: ApplicationCommandOptionType.String,
      required: true,
      maxLength: 4000,
    })
    description: string,
    @SlashOption({
      name: "role-1",
      description: "First opt-in role",
      type: ApplicationCommandOptionType.Role,
      required: true,
    })
    role1: Role,
    @SlashOption({
      name: "emoji-1",
      description: "First button emoji (<:name:id> or unicode)",
      type: ApplicationCommandOptionType.String,
      required: true,
      maxLength: 64,
    })
    emoji1: string,
    @SlashOption({
      name: "label-1",
      description: "First button label",
      type: ApplicationCommandOptionType.String,
      required: true,
      maxLength: 80,
    })
    label1: string,
    @SlashOption({
      name: "role-2",
      description: "Second opt-in role",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    role2: Role | null,
    @SlashOption({
      name: "emoji-2",
      description: "Second button emoji",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 64,
    })
    emoji2: string | null,
    @SlashOption({
      name: "label-2",
      description: "Second button label",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 80,
    })
    label2: string | null,
    @SlashOption({
      name: "role-3",
      description: "Third opt-in role",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    role3: Role | null,
    @SlashOption({
      name: "emoji-3",
      description: "Third button emoji",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 64,
    })
    emoji3: string | null,
    @SlashOption({
      name: "label-3",
      description: "Third button label",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 80,
    })
    label3: string | null,
    @SlashOption({
      name: "role-4",
      description: "Fourth opt-in role",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    role4: Role | null,
    @SlashOption({
      name: "emoji-4",
      description: "Fourth button emoji",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 64,
    })
    emoji4: string | null,
    @SlashOption({
      name: "label-4",
      description: "Fourth button label",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 80,
    })
    label4: string | null,
    @SlashOption({
      name: "role-5",
      description: "Fifth opt-in role",
      type: ApplicationCommandOptionType.Role,
      required: false,
    })
    role5: Role | null,
    @SlashOption({
      name: "emoji-5",
      description: "Fifth button emoji",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 64,
    })
    emoji5: string | null,
    @SlashOption({
      name: "label-5",
      description: "Fifth button label",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 80,
    })
    label5: string | null,
    @SlashOption({
      name: "channel",
      description: "Channel to post in (defaults to the current channel)",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildVoice,
      ],
      required: false,
    })
    channel: GuildBasedChannel | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    const collected = collectCustomButtons([
      { role: role1, emoji: emoji1, label: label1 },
      { role: role2, emoji: emoji2, label: label2 },
      { role: role3, emoji: emoji3, label: label3 },
      { role: role4, emoji: emoji4, label: label4 },
      { role: role5, emoji: emoji5, label: label5 },
    ]);

    if (!collected.ok) {
      await interaction.reply({
        content: collected.message,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = resolvePostChannel(channel, interaction);
    if (!target) {
      await interaction.reply({
        content: "❌ Run this in a server text channel, or pass a text channel to post in.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      await optRolePanelManager.post(
        target,
        buildCustomOptRolePanel(description, collected.buttons),
      );

      try {
        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "opt-roles-custom",
          interaction.user.id,
          undefined,
          `${collected.buttons.length} role(s) in ${target.id}`,
        );
      } catch (logError) {
        loggers.bot.warn("Failed to log opt-roles custom", logError);
      }

      await interaction.editReply({
        content: `✅ Posted a custom opt-in panel with ${collected.buttons.length} role button(s) in ${target}.`,
      });
    } catch (error) {
      loggers.bot.error("opt-roles custom command error", error);
      await interaction.editReply({
        content:
          "❌ Failed to post the panel. Check that I can send messages and use those emojis in that channel.",
      });
    }
  }
}
