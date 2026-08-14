import { prisma } from "../../main.js";
import type { RequireResult } from "../requireResult.js";

export type AttendanceAutofillConfig = {
  patrolCategoryId: string;
  enrolledChannels: string[];
};

const NO_PATROL_CATEGORY_MESSAGE =
  "Patrol category is not configured. Please configure it in the guild settings first.";

const NO_ENROLLED_CHANNELS_MESSAGE =
  "No enrolled channels configured. Please configure enrolled channels in the guild settings first.";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function requirePatrolCategory(
  guildId: string,
): Promise<RequireResult<string>> {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { patrolChannelCategoryId: true },
  });

  if (!settings?.patrolChannelCategoryId) {
    return { ok: false, message: NO_PATROL_CATEGORY_MESSAGE };
  }

  return { ok: true, value: settings.patrolChannelCategoryId };
}

export async function requireEnrolledChannels(
  guildId: string,
): Promise<RequireResult<string[]>> {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: { enrolledChannels: true },
  });

  const enrolledChannels = asStringArray(settings?.enrolledChannels);
  if (enrolledChannels.length === 0) {
    return { ok: false, message: NO_ENROLLED_CHANNELS_MESSAGE };
  }

  return { ok: true, value: enrolledChannels };
}

export async function requireAttendanceAutofillConfig(
  guildId: string,
): Promise<RequireResult<AttendanceAutofillConfig>> {
  const settings = await prisma.guildSettings.findUnique({
    where: { guildId },
    select: {
      patrolChannelCategoryId: true,
      enrolledChannels: true,
    },
  });

  if (!settings?.patrolChannelCategoryId) {
    return { ok: false, message: NO_PATROL_CATEGORY_MESSAGE };
  }

  const enrolledChannels = asStringArray(settings.enrolledChannels);
  if (enrolledChannels.length === 0) {
    return { ok: false, message: NO_ENROLLED_CHANNELS_MESSAGE };
  }

  return {
    ok: true,
    value: {
      patrolCategoryId: settings.patrolChannelCategoryId,
      enrolledChannels,
    },
  };
}
