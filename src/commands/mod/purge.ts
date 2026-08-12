import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  AttachmentBuilder,
  ChannelType,
  CommandInteraction,
  GuildTextBasedChannel,
  MessageFlags,
  PermissionFlagsBits,
  User,
} from "discord.js";
import { PermissionNodeGuard } from "../../utility/guards.js";
import {
  auditLogManager,
  messageArchiveManager,
  modCaseManager,
  patrolTimer,
} from "../../main.js";
import { loggers } from "../../utility/logger.js";
import type { CachedMessageSnapshot } from "../../managers/logging/index.js";

@Discord()
@SlashGroup("mod")
@Guard(PermissionNodeGuard("mod.command.purge"))
export class PurgeCommand {
  @Slash({
    name: "purge",
    description: "Bulk delete messages and archive contents to TXT",
  })
  async purge(
    @SlashOption({
      name: "amount",
      description: "Number of messages to scan (1–100)",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      minValue: 1,
      maxValue: 100,
    })
    amount: number,
    @SlashOption({
      name: "user",
      description: "Only delete messages from this user",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    user: User | null,
    @SlashOption({
      name: "bots",
      description: "Only delete bot messages",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    bots: boolean | null,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId || !interaction.guild || !interaction.channel) {
      await interaction.reply({
        content: "❌ This command can only be used in a server text channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      interaction.channel.type !== ChannelType.GuildText &&
      interaction.channel.type !== ChannelType.GuildAnnouncement &&
      !interaction.channel.isThread()
    ) {
      await interaction.reply({
        content: "❌ Purge only works in text channels or threads.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.channel as GuildTextBasedChannel;
    const me = interaction.guild.members.me;
    if (!me?.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: "❌ I need Manage Messages in this channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const fetched = await channel.messages.fetch({ limit: amount });
      const toDelete = fetched.filter((msg) => {
        if (user && msg.author.id !== user.id) {
          return false;
        }
        if (bots === true && !msg.author.bot) {
          return false;
        }
        return true;
      });

      if (toDelete.size === 0) {
        await interaction.editReply({
          content: "ℹ️ No messages matched the filter.",
        });
        return;
      }

      const archived = await messageArchiveManager.getByMessageIds([
        ...toDelete.keys(),
      ]);
      const byId = new Map(archived.map((s) => [s.messageId, s]));

      const pendingSnapshots: CachedMessageSnapshot[] = [];
      for (const msg of toDelete.values()) {
        const snap =
          byId.get(msg.id) ??
          (await messageArchiveManager.snapshotFromDiscord(msg));
        if (snap) {
          pendingSnapshots.push(snap);
        }
      }

      const deleted = await channel.bulkDelete(toDelete, true);
      const snapshots = pendingSnapshots.filter((s) => deleted.has(s.messageId));

      const modCase = await modCaseManager.createCase({
        guildId: interaction.guildId,
        type: "PURGE",
        targetId: user?.id ?? channel.id,
        moderatorId: interaction.user.id,
        reason: `Purged ${deleted.size} message(s) in <#${channel.id}>`,
        claimable: true,
        extraFields: [
          {
            name: "Channel",
            value: auditLogManager.formatChannel(channel.id),
            inline: true,
          },
          {
            name: "Deleted",
            value: String(deleted.size),
            inline: true,
          },
        ],
      });

      await interaction.editReply({
        content: `✅ Deleted **${deleted.size}** message(s). Archive attached to Messages/Moderation logs (case #${modCase.caseNumber}).`,
      });

      try {
        const txt = messageArchiveManager.buildPurgeTxt(channel.id, snapshots);
        const file = new AttachmentBuilder(Buffer.from(txt, "utf8"), {
          name: `purge-${channel.id}-${Date.now()}.txt`,
        });

        const messagesLog = await auditLogManager.postLog({
          guildId: interaction.guildId,
          category: "messages",
          title: "Messages Purged",
          severity: "warn",
          fields: [
            {
              name: "Moderator",
              value: await auditLogManager.formatUser(
                interaction.user.id,
                interaction.user.username,
              ),
              inline: true,
            },
            {
              name: "Channel",
              value: auditLogManager.formatChannel(channel.id),
              inline: true,
            },
            {
              name: "Deleted",
              value: String(deleted.size),
              inline: true,
            },
            {
              name: "Case",
              value: `#${modCase.caseNumber}`,
              inline: true,
            },
          ],
          files: [file],
          sourceChannelId: channel.id,
        });

        await messageArchiveManager.storePurgeArchive({
          guildId: interaction.guildId,
          channelId: channel.id,
          moderatorId: interaction.user.id,
          snapshots,
          txtContent: txt,
          logMessageId: messagesLog?.id,
          logThreadId: messagesLog?.channelId,
          caseId: modCase.id,
        });

        await messageArchiveManager.deleteCachedMany([...deleted.keys()]);

        await patrolTimer.logCommandUsage(
          interaction.guildId,
          "purge",
          interaction.user.id,
          user?.id,
          channel.id,
        );
      } catch (logError) {
        loggers.bot.warn("Failed to log purge archive/usage after success", logError);
      }
    } catch (error) {
      loggers.bot.error("Purge failed", error);
      await interaction.editReply({
        content: `❌ Purge failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }
}
