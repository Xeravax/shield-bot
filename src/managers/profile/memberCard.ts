import { Colors, EmbedBuilder } from "discord.js";

export const VIEW_PRIVATE_MEMBER_CARD_NODE = "user.manage.view-private-card";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type MemberCardVisibilityInput = {
  viewerId: string;
  targetId: string;
  memberCardPublic: boolean;
  viewerCanViewPrivate: boolean;
};

export type MemberCardLoa = {
  status: string;
  endDate: Date;
} | null;

export type MemberCardTarget = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export type MemberCardDetails = {
  vrchatLine: string | null;
  hoursThisMonth: string;
  hoursMonthLabel: string;
  loa: MemberCardLoa;
};

export type MemberCardInput = {
  target: MemberCardTarget;
  visibility: MemberCardVisibilityInput;
  details: MemberCardDetails;
};

export function canViewMemberCardDetails(
  input: MemberCardVisibilityInput,
): boolean {
  if (input.viewerId === input.targetId) {
    return true;
  }
  if (input.viewerCanViewPrivate) {
    return true;
  }
  return input.memberCardPublic;
}

export function isPrivateStaffOverride(
  input: MemberCardVisibilityInput,
): boolean {
  return (
    input.viewerId !== input.targetId &&
    input.viewerCanViewPrivate &&
    !input.memberCardPublic
  );
}

export function formatMemberCardLoa(loa: MemberCardLoa): string {
  if (loa?.status === "ACTIVE") {
    const unix = Math.floor(loa.endDate.getTime() / 1000);
    return `On leave until <t:${unix}:D>`;
  }
  return "Not on leave";
}

export function formatHoursMonthLabel(date: Date = new Date()): {
  year: number;
  month: number;
  label: string;
} {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return {
    year,
    month,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
  };
}

export function memberCardFooterText(
  visibility: MemberCardVisibilityInput,
): string | null {
  if (!canViewMemberCardDetails(visibility)) {
    return null;
  }
  if (visibility.viewerId === visibility.targetId && !visibility.memberCardPublic) {
    return "Preview — others cannot see these details until you enable Public member card in /profile settings.";
  }
  if (isPrivateStaffOverride(visibility)) {
    return "Private card — visible because you can view private member cards.";
  }
  return null;
}

export function buildMemberCardEmbed(input: MemberCardInput): EmbedBuilder {
  const { target, visibility, details } = input;
  const embed = new EmbedBuilder()
    .setTitle("Member card")
    .setColor(Colors.Blurple)
    .setAuthor({
      name: target.displayName,
      iconURL: target.avatarUrl ?? undefined,
    });

  const discordField = {
    name: "Discord",
    value: `<@${target.id}>`,
    inline: false,
  };

  if (!canViewMemberCardDetails(visibility)) {
    return embed
      .setDescription("This member has not shared a public card.")
      .addFields(discordField);
  }

  const footer = memberCardFooterText(visibility);
  if (footer) {
    embed.setFooter({ text: footer });
  }

  return embed.addFields(
    discordField,
    {
      name: "VRChat",
      value: details.vrchatLine ?? "None linked",
      inline: false,
    },
    {
      name: `Hours this month (${details.hoursMonthLabel}, UTC)`,
      value: details.hoursThisMonth,
      inline: false,
    },
    {
      name: "Leave of absence",
      value: formatMemberCardLoa(details.loa),
      inline: false,
    },
  );
}
