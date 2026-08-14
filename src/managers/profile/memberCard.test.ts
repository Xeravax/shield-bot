import { describe, expect, it } from "vitest";
import {
  buildMemberCardEmbed,
  canViewMemberCardDetails,
  formatHoursMonthLabel,
  formatMemberCardLoa,
  isPrivateStaffOverride,
  memberCardFooterText,
  type MemberCardInput,
  type MemberCardVisibilityInput,
} from "./memberCard.js";

const TARGET_ID = "111";
const VIEWER_ID = "222";

function visibility(
  overrides: Partial<MemberCardVisibilityInput> = {},
): MemberCardVisibilityInput {
  return {
    viewerId: VIEWER_ID,
    targetId: TARGET_ID,
    memberCardPublic: false,
    viewerCanViewPrivate: false,
    ...overrides,
  };
}

function cardInput(
  overrides: Partial<MemberCardInput> & {
    visibility?: MemberCardVisibilityInput;
  } = {},
): MemberCardInput {
  return {
    target: {
      id: TARGET_ID,
      displayName: "Shield Member",
      avatarUrl: null,
    },
    visibility: visibility(),
    details: {
      vrchatLine: "[Main](<https://vrchat.com/home/user/usr_1>) (`usr_1`)",
      hoursThisMonth: "4h 20m",
      hoursMonthLabel: "August 2026",
      loa: null,
    },
    ...overrides,
  };
}

function fieldNames(embed: ReturnType<typeof buildMemberCardEmbed>): string[] {
  return (embed.data.fields ?? []).map((field) => field.name);
}

function fieldValue(
  embed: ReturnType<typeof buildMemberCardEmbed>,
  name: string,
): string | undefined {
  return embed.data.fields?.find((field) => field.name === name)?.value;
}

describe("canViewMemberCardDetails", () => {
  it("lets the target always see their own card", () => {
    expect(
      canViewMemberCardDetails(
        visibility({ viewerId: TARGET_ID, memberCardPublic: false }),
      ),
    ).toBe(true);
  });

  it("lets staff see a private card", () => {
    expect(
      canViewMemberCardDetails(visibility({ viewerCanViewPrivate: true })),
    ).toBe(true);
  });

  it("lets other members see an opted-in card", () => {
    expect(
      canViewMemberCardDetails(visibility({ memberCardPublic: true })),
    ).toBe(true);
  });

  it("hides details from other members when the target has not opted in", () => {
    expect(canViewMemberCardDetails(visibility())).toBe(false);
  });
});

describe("isPrivateStaffOverride", () => {
  it("is true only for staff viewing someone else's private card", () => {
    expect(
      isPrivateStaffOverride(visibility({ viewerCanViewPrivate: true })),
    ).toBe(true);
    expect(
      isPrivateStaffOverride(
        visibility({ viewerId: TARGET_ID, viewerCanViewPrivate: true }),
      ),
    ).toBe(false);
    expect(
      isPrivateStaffOverride(
        visibility({ viewerCanViewPrivate: true, memberCardPublic: true }),
      ),
    ).toBe(false);
    expect(isPrivateStaffOverride(visibility())).toBe(false);
  });
});

describe("formatMemberCardLoa", () => {
  it("shows the end date only for ACTIVE leave", () => {
    const endDate = new Date(Date.UTC(2026, 7, 20));
    expect(formatMemberCardLoa({ status: "ACTIVE", endDate })).toBe(
      `On leave until <t:${Math.floor(endDate.getTime() / 1000)}:D>`,
    );
  });

  it("treats APPROVED upcoming leave as not on leave", () => {
    expect(
      formatMemberCardLoa({
        status: "APPROVED",
        endDate: new Date(Date.UTC(2026, 8, 1)),
      }),
    ).toBe("Not on leave");
  });

  it("treats missing LOA as not on leave", () => {
    expect(formatMemberCardLoa(null)).toBe("Not on leave");
  });
});

describe("formatHoursMonthLabel", () => {
  it("labels the UTC month", () => {
    expect(formatHoursMonthLabel(new Date(Date.UTC(2026, 7, 14)))).toEqual({
      year: 2026,
      month: 8,
      label: "August 2026",
    });
  });
});

describe("memberCardFooterText", () => {
  it("explains the self preview when the card is not public", () => {
    expect(
      memberCardFooterText(
        visibility({ viewerId: TARGET_ID, memberCardPublic: false }),
      ),
    ).toMatch(/Preview/);
  });

  it("notes a staff override on a private card", () => {
    expect(
      memberCardFooterText(visibility({ viewerCanViewPrivate: true })),
    ).toMatch(/Private card/);
  });

  it("has no footer for a public card", () => {
    expect(
      memberCardFooterText(visibility({ memberCardPublic: true })),
    ).toBeNull();
  });
});

describe("buildMemberCardEmbed", () => {
  it("omits hours, VRChat, and LOA when the viewer cannot see details", () => {
    const embed = buildMemberCardEmbed(cardInput());
    expect(embed.data.description).toMatch(/has not shared a public card/);
    expect(fieldNames(embed)).toEqual(["Discord"]);
    expect(fieldValue(embed, "VRChat")).toBeUndefined();
    expect(
      fieldNames(embed).some((name) => name.startsWith("Hours this month")),
    ).toBe(false);
    expect(fieldValue(embed, "Leave of absence")).toBeUndefined();
  });

  it("shows MAIN VRChat, hours, and LOA on a full card", () => {
    const endDate = new Date(Date.UTC(2026, 7, 20));
    const embed = buildMemberCardEmbed(
      cardInput({
        visibility: visibility({ memberCardPublic: true }),
        details: {
          vrchatLine: "[Main](<https://vrchat.com/home/user/usr_1>) (`usr_1`)",
          hoursThisMonth: "4h 20m",
          hoursMonthLabel: "August 2026",
          loa: { status: "ACTIVE", endDate },
        },
      }),
    );
    expect(embed.data.description).toBeUndefined();
    expect(fieldValue(embed, "VRChat")).toContain("usr_1");
    expect(fieldValue(embed, "Hours this month (August 2026, UTC)")).toBe(
      "4h 20m",
    );
    expect(fieldValue(embed, "Leave of absence")).toBe(
      `On leave until <t:${Math.floor(endDate.getTime() / 1000)}:D>`,
    );
  });

  it("shows None linked and 0s when there is no account or hours", () => {
    const embed = buildMemberCardEmbed(
      cardInput({
        visibility: visibility({ viewerId: TARGET_ID }),
        details: {
          vrchatLine: null,
          hoursThisMonth: "0s",
          hoursMonthLabel: "August 2026",
          loa: { status: "APPROVED", endDate: new Date() },
        },
      }),
    );
    expect(fieldValue(embed, "VRChat")).toBe("None linked");
    expect(fieldValue(embed, "Hours this month (August 2026, UTC)")).toBe("0s");
    expect(fieldValue(embed, "Leave of absence")).toBe("Not on leave");
    expect(embed.data.footer?.text).toMatch(/Preview/);
  });
});
