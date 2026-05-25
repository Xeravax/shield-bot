import {
  ButtonBuilder,
  ButtonStyle,
  Colors,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
} from "discord.js";
import { prisma, patrolTimer, aocPanelManager } from "../main.js";
import { loggers } from "./logger.js";

export const PHANTOM_PC_BUTTON_ENROLL = "phantom-pc:enroll";
export const PHANTOM_PC_BUTTON_UNENROLL = "phantom-pc:unenroll";
export const PHANTOM_PC_MODAL_ENROLL = "phantom-pc-m:enroll";

export const REASON_OPTION_DESCRIPTION =
  "Phantom/sensory needs (use \\n for line breaks)";

/** Turn literal \\n sequences from slash input into real newlines for display. */
export function formatPhantomCompilerReason(raw: string): string {
  return raw.replace(/\\n/g, "\n");
}

function truncateForLogEmbed(text: string, max = 1000): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

export type EnrollResult =
  | { ok: true; discordId: string; updated: boolean }
  | { ok: false; message: string };

export type UnenrollResult =
  | { ok: true }
  | { ok: false; message: string };

export async function enrollPhantomCompiler(
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
        "❌ You need a **verified MAIN** VRChat account linked before enrolling. Use `/verify account` first.",
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

export async function unenrollPhantomCompiler(
  discordId: string,
): Promise<UnenrollResult> {
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
  if (!mainAccount?.phantomCompilerReason) {
    return {
      ok: false,
      message: "ℹ️ You are not currently enrolled on the phantom compiler list.",
    };
  }

  await prisma.vRChatAccount.update({
    where: { id: mainAccount.id },
    data: {
      phantomCompilerReason: null,
      phantomCompilerEnrolledAt: null,
    },
  });

  return { ok: true };
}

export async function notifyPhantomCompilerEnrollment(
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

export async function notifyPhantomCompilerUnenroll(
  guildId: string,
  discordId: string,
  source: "slash" | "panel",
): Promise<void> {
  const via = source === "panel" ? "Self-removed via panel." : "Self-removed via command.";
  await patrolTimer.logCommandUsage(
    guildId,
    "phantom-compiler-unenroll",
    discordId,
    discordId,
    via,
  );
}

export function buildPhantomCompilerSelfServicePanel(): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(Colors.Gold)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "**Phantom Compiler — Self Enrollment**",
          "",
          "If you use a phantom compiler or have sensory needs staff should know about while on patrol, enroll below.",
          "Your reason is shown on the **AoC panel** when you are on patrol.",
          "",
          "Requires a verified **MAIN** VRChat account.",
        ].join("\n"),
      ),
    )
    .addSectionComponents(
      new SectionBuilder()
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(PHANTOM_PC_BUTTON_ENROLL)
            .setLabel("Enroll / update")
            .setStyle(ButtonStyle.Success),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "**Add or update** — opens a form for your phantom/sensory needs.",
          ),
        ),
      new SectionBuilder()
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(PHANTOM_PC_BUTTON_UNENROLL)
            .setLabel("Unenroll")
            .setStyle(ButtonStyle.Danger),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            "**Remove** — take yourself off the phantom compiler list.",
          ),
        ),
    );
}

export function scheduleAoCPanelRefresh(guildId: string): void {
  try {
    aocPanelManager.scheduleRefresh(guildId);
  } catch (err) {
    loggers.bot.error("Failed to schedule AoC panel refresh after phantom compiler change", err);
  }
}

export const phantomCompilerPanelMessageFlags = MessageFlags.IsComponentsV2;
