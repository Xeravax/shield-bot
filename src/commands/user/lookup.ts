import { ContextMenu, Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  CommandInteraction,
  GuildMember,
  MessageFlags,
  User,
  UserContextMenuCommandInteraction,
} from "discord.js";
import { loaManager, patrolTimer } from "../../main.js";
import {
  formatVrchatProfileLine,
  getLinkedVrchatAccounts,
} from "../../managers/logging/userDisplay.js";
import {
  buildMemberCardEmbed,
  formatHoursMonthLabel,
  VIEW_PRIVATE_MEMBER_CARD_NODE,
} from "../../managers/profile/memberCard.js";
import { GuildGuard } from "../../utility/guards.js";
import { hasNode } from "../../utility/permissionNodes.js";
import { getResolvedUserPreferences } from "../../utility/userPreferences.js";
import { loggers } from "../../utility/logger.js";

type MemberCardInteraction =
  | CommandInteraction
  | UserContextMenuCommandInteraction;

async function replyWithMemberCard(
  interaction: MemberCardInteraction,
  targetUser: User,
): Promise<void> {
  if (targetUser.bot) {
    await interaction.reply({
      content: "❌ Bots don't have member cards.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId || !interaction.guild) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const viewerMember = interaction.member;
  if (!viewerMember || !("roles" in viewerMember)) {
    await interaction.reply({
      content: "Could not resolve your server membership.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const [prefs, viewerCanViewPrivate, accounts, loa] = await Promise.all([
      getResolvedUserPreferences(targetUser.id),
      hasNode(viewerMember as GuildMember, VIEW_PRIVATE_MEMBER_CARD_NODE),
      getLinkedVrchatAccounts(targetUser.id),
      loaManager.getActiveLOA(guildId, targetUser.id),
    ]);

    const { year, month, label } = formatHoursMonthLabel();
    const hoursMs = await patrolTimer.getUserTotalForMonth(
      guildId,
      targetUser.id,
      year,
      month,
    );

    const guildMember = interaction.guild.members.cache.get(targetUser.id);
    const main = accounts.find((account) => account.accountType === "MAIN") ?? null;

    const embed = buildMemberCardEmbed({
      target: {
        id: targetUser.id,
        displayName: guildMember?.displayName ?? targetUser.displayName,
        avatarUrl: targetUser.displayAvatarURL(),
      },
      visibility: {
        viewerId: interaction.user.id,
        targetId: targetUser.id,
        memberCardPublic: prefs.memberCardPublic,
        viewerCanViewPrivate,
      },
      details: {
        vrchatLine: main
          ? formatVrchatProfileLine(main.vrcUserId, main.vrchatUsername)
          : null,
        hoursThisMonth: patrolTimer.formatDurationPublic(hoursMs),
        hoursMonthLabel: label,
        loa: loa ? { status: loa.status, endDate: loa.endDate } : null,
      },
    });

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    loggers.bot.error("Error building member card", error);
    const content = "❌ Failed to load that member card. Please try again.";
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content }).catch(() => {});
      return;
    }
    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
    });
  }
}

@Discord()
@SlashGroup("user")
export class UserLookupCommand {
  @Slash({
    name: "lookup",
    description: "View a member card: verified account, hours this month, and LOA status.",
  })
  @Guard(GuildGuard)
  async lookup(
    @SlashOption({
      name: "user",
      description: "Member to look up (defaults to you)",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    user: User | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    await replyWithMemberCard(interaction, user ?? interaction.user);
  }
}

@Discord()
export class MemberCardContextMenu {
  @ContextMenu({
    name: "View member card",
    type: ApplicationCommandType.User,
  })
  @Guard(GuildGuard)
  async viewMemberCard(
    interaction: UserContextMenuCommandInteraction,
  ): Promise<void> {
    await replyWithMemberCard(interaction, interaction.targetUser);
  }
}
