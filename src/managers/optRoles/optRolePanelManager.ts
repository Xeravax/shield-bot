import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Colors,
  ContainerBuilder,
  DiscordAPIError,
  Guild,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type MessageActionRowComponentBuilder,
  type SendableChannels,
} from "discord.js";
import { loggers } from "../../utility/logger.js";
import {
  GOLDEN_COOKIE_DIVIDER,
  getOptInRequirementError,
  getOptRoleEligibilityError,
  optRoleButtonCustomId,
  type OptRoleButton,
  type OptRolePanel,
  type ToggleOptRoleResult,
} from "./optRolePanel.js";

/**
 * Builds, posts, and toggles button-based opt-in role panels.
 */
export class OptRolePanelManager {
  build(panel: OptRolePanel): ContainerBuilder {
    const container = new ContainerBuilder().setAccentColor(Colors.Gold);

    panel.sections.forEach((section, index) => {
      if (index > 0) {
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(GOLDEN_COOKIE_DIVIDER),
        );
      }

      const hintBlock = section.buttons.map((button) => button.hint).join("\n");
      const sectionText = hintBlock
        ? `${section.body}\n\n${hintBlock}`
        : section.body;

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(sectionText),
      );
      container.addActionRowComponents(this.buildButtonRow(section.buttons));
    });

    if (panel.footer) {
      container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
      );
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(panel.footer));
    }

    return container;
  }

  async post(channel: SendableChannels, panel: OptRolePanel): Promise<void> {
    await channel.send({
      components: [this.build(panel)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  }

  async toggle(
    guild: Guild,
    member: GuildMember,
    roleId: string,
  ): Promise<ToggleOptRoleResult> {
    const role =
      guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) {
      return { ok: false, message: "❌ That opt-in role no longer exists." };
    }

    const eligibilityError = getOptRoleEligibilityError(role);
    if (eligibilityError) {
      return { ok: false, message: eligibilityError };
    }

    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    if (!me) {
      return { ok: false, message: "❌ I could not verify my permissions in this server." };
    }

    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return {
        ok: false,
        message: "❌ I need the **Manage Roles** permission to assign opt-in roles.",
      };
    }

    if (role.position >= me.roles.highest.position) {
      return {
        ok: false,
        message:
          "❌ That role is higher than or equal to my highest role. Move my role above it, then try again.",
      };
    }

    const hasRole = member.roles.cache.has(role.id);

    // Requirements only apply when adding; members can always remove the ping role.
    if (!hasRole) {
      const requirementError = getOptInRequirementError(member.roles.cache.keys(), role.id);
      if (requirementError) {
        return { ok: false, message: requirementError };
      }
    }

    try {
      if (hasRole) {
        await member.roles.remove(role, "Opt-in role panel");
        return { ok: true, added: false, roleName: role.name };
      }

      await member.roles.add(role, "Opt-in role panel");
      return { ok: true, added: true, roleName: role.name };
    } catch (error) {
      loggers.bot.error("Failed to toggle opt-in role", error, {
        guildId: guild.id,
        userId: member.id,
        roleId,
      });

      if (
        error instanceof DiscordAPIError &&
        error.code === RESTJSONErrorCodes.MissingPermissions
      ) {
        return {
          ok: false,
          message: "❌ I don't have permission to update that role.",
        };
      }

      return {
        ok: false,
        message: "❌ Failed to update your roles. Please try again in a moment.",
      };
    }
  }

  private buildButtonRow(
    buttons: OptRoleButton[],
  ): ActionRowBuilder<MessageActionRowComponentBuilder> {
    return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      buttons.map((button) =>
        new ButtonBuilder()
          .setCustomId(optRoleButtonCustomId(button.roleId))
          .setStyle(ButtonStyle.Secondary)
          .setLabel(button.label)
          .setEmoji(button.emoji),
      ),
    );
  }
}

export const optRolePanelManager = new OptRolePanelManager();
