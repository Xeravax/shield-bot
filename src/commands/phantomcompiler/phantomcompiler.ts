import { Discord, Guard, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
  User,
} from "discord.js";
import { prisma, patrolTimer, aocPanelManager } from "../../main.js";
import { GuildGuard, StaffGuard } from "../../utility/guards.js";
import { loggers } from "../../utility/logger.js";

const REASON_OPTION_DESCRIPTION =
  "Phantom/sensory needs (use \\n for line breaks)";

/** Turn literal \\n sequences from slash input into real newlines for display. */
function formatPhantomCompilerReason(raw: string): string {
  return raw.replace(/\\n/g, "\n");
}

function truncateForLogEmbed(text: string, max = 1000): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

type EnrollResult =
  | { ok: true; discordId: string; updated: boolean }
  | { ok: false; message: string };

async function enrollPhantomCompiler(
  discordId: string,
  reason: string,
): Promise<EnrollResult> {
  const formattedReason = formatPhantomCompilerReason(reason);

  const user = await prisma.user.findUnique({
    where: { discordId },
    include: {
      vrchatAccounts: {
        where: { accountType: "MAIN" },
        take: 1,
      },
    },
  });

  const mainAccount = user?.vrchatAccounts?.[0];
  if (!mainAccount) {
    return {
      ok: false,
      message:
        "❌ That user needs a **verified MAIN** VRChat account linked before enrolling.",
    };
  }

  const updated = !!mainAccount.phantomCompilerReason;

  await prisma.vRChatAccount.update({
    where: { id: mainAccount.id },
    data: {
      phantomCompilerReason: formattedReason,
      phantomCompilerEnrolledAt: mainAccount.phantomCompilerEnrolledAt ?? new Date(),
    },
  });

  return { ok: true, discordId, updated };
}

async function notifyPhantomCompilerEnrollment(
  guildId: string,
  enrolledDiscordId: string,
  executorId: string,
  reason: string,
  staffEnrolled: boolean,
): Promise<void> {
  const action = staffEnrolled
    ? "phantom-compiler-staff-enroll"
    : "phantom-compiler-enroll";

  const details = truncateForLogEmbed(
    [
      staffEnrolled ? "Enrolled by staff." : "Self-enrolled.",
      "",
      "**Reason:**",
      formatPhantomCompilerReason(reason),
    ].join("\n"),
  );

  await patrolTimer.logCommandUsage(
    guildId,
    action,
    executorId,
    enrolledDiscordId,
    details,
  );
}

@Discord()
@SlashGroup({
  name: "phantomcompiler",
  description: "Phantom compiler / sensory needs",
})
@SlashGroup("phantomcompiler")
@Guard(GuildGuard)
export class PhantomCompilerCommands {
  @Slash({
    name: "enroll",
    description: "Enroll your MAIN verified VRChat account on the phantom compiler list",
  })
  async enroll(
    @SlashOption({
      name: "reason",
      description: REASON_OPTION_DESCRIPTION,
      type: ApplicationCommandOptionType.String,
      required: true,
      maxLength: 2000,
    })
    reason: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await enrollPhantomCompiler(interaction.user.id, reason);
      if (!result.ok) {
        await interaction.editReply({ content: result.message });
        return;
      }

      await notifyPhantomCompilerEnrollment(
        interaction.guildId,
        result.discordId,
        interaction.user.id,
        reason,
        false,
      );

      const message = result.updated
        ? "✅ Your phantom compiler enrollment has been updated."
        : "✅ You are enrolled on the phantom compiler list. Staff can see your needs on the AoC panel when you are on patrol.";

      await interaction.editReply({ content: message });
      aocPanelManager.scheduleRefresh(interaction.guildId);
    } catch (error) {
      loggers.bot.error("phantomcompiler enroll error", error);
      await interaction.editReply({
        content: "❌ Failed to enroll. Please try again later.",
      });
    }
  }

  @Slash({
    name: "add",
    description: "Enroll a member on the phantom compiler list (staff)",
  })
  @Guard(StaffGuard)
  async add(
    @SlashOption({
      name: "user",
      description: "Member to enroll",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    target: User,
    @SlashOption({
      name: "reason",
      description: REASON_OPTION_DESCRIPTION,
      type: ApplicationCommandOptionType.String,
      required: true,
      maxLength: 2000,
    })
    reason: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await enrollPhantomCompiler(target.id, reason);
      if (!result.ok) {
        await interaction.editReply({ content: result.message });
        return;
      }

      await notifyPhantomCompilerEnrollment(
        interaction.guildId,
        result.discordId,
        interaction.user.id,
        reason,
        true,
      );

      const message = result.updated
        ? `✅ Updated phantom compiler enrollment for <@${target.id}>.`
        : `✅ Enrolled <@${target.id}> on the phantom compiler list.`;

      await interaction.editReply({ content: message });
      aocPanelManager.scheduleRefresh(interaction.guildId);
    } catch (error) {
      loggers.bot.error("phantomcompiler add error", error);
      await interaction.editReply({
        content: "❌ Failed to enroll member. Please try again later.",
      });
    }
  }

  @Slash({
    name: "unenroll",
    description: "Remove your phantom compiler enrollment",
  })
  async unenroll(interaction: CommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const user = await prisma.user.findUnique({
        where: { discordId: interaction.user.id },
        include: {
          vrchatAccounts: {
            where: { accountType: "MAIN" },
            take: 1,
          },
        },
      });

      const mainAccount = user?.vrchatAccounts?.[0];
      if (!mainAccount?.phantomCompilerReason) {
        await interaction.editReply({
          content: "ℹ️ You are not currently enrolled on the phantom compiler list.",
        });
        return;
      }

      await prisma.vRChatAccount.update({
        where: { id: mainAccount.id },
        data: {
          phantomCompilerReason: null,
          phantomCompilerEnrolledAt: null,
        },
      });

      await interaction.editReply({
        content: "✅ You have been removed from the phantom compiler list.",
      });

      aocPanelManager.scheduleRefresh(interaction.guildId);
    } catch (error) {
      loggers.bot.error("phantomcompiler unenroll error", error);
      await interaction.editReply({
        content: "❌ Failed to unenroll. Please try again later.",
      });
    }
  }
}
