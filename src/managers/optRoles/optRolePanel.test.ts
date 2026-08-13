import { describe, expect, it } from "vitest";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import {
  OPT_ROLE_PRESETS,
  ROLE_EMT_MEMBER,
  ROLE_SHIELD_MEMBER,
  ROLE_TRU_MEMBER,
  SENSITIVE_OPT_ROLE_PERMISSIONS,
  formatEmojiMarkdown,
  getOptInRequirementError,
  getOptRoleEligibilityError,
  getRequiredRoleIdsForOptIn,
  optRoleButtonCustomId,
  parseOptRoleButtonCustomId,
  parseOptRoleEmoji,
  type OptRoleEligibilityInput,
} from "./optRolePanel.js";

function eligibilityRole(
  overrides: Partial<OptRoleEligibilityInput> & {
    permissionsBits?: bigint;
  } = {},
): OptRoleEligibilityInput {
  const { permissionsBits, ...rest } = overrides;
  return {
    id: "999871775993233488",
    managed: false,
    guild: { id: "1" },
    permissions: new PermissionsBitField(permissionsBits ?? 0n),
    ...rest,
  };
}

describe("parseOptRoleEmoji", () => {
  it("parses static custom emojis", () => {
    expect(parseOptRoleEmoji("<:vrcAlert:999877368216825936>")).toEqual({
      animated: false,
      name: "vrcAlert",
      id: "999877368216825936",
    });
  });

  it("parses animated custom emojis", () => {
    expect(parseOptRoleEmoji("<a:GOLDENCOOKIE:868564750001381378>")).toEqual({
      animated: true,
      name: "GOLDENCOOKIE",
      id: "868564750001381378",
    });
  });

  it("parses raw snowflake ids", () => {
    expect(parseOptRoleEmoji("826263186071879710")).toEqual({
      id: "826263186071879710",
      name: "emoji",
    });
  });

  it("parses unicode emojis", () => {
    expect(parseOptRoleEmoji("🎥")).toEqual({ name: "🎥" });
    expect(parseOptRoleEmoji("⭐")).toEqual({ name: "⭐" });
  });

  it("rejects empty or malformed input", () => {
    expect(parseOptRoleEmoji("")).toBeNull();
    expect(parseOptRoleEmoji("   ")).toBeNull();
    expect(parseOptRoleEmoji("<:missingid>")).toBeNull();
    expect(parseOptRoleEmoji("not an emoji at all")).toBeNull();
  });

  it("rejects custom emojis with leading or trailing text", () => {
    expect(parseOptRoleEmoji("<:vrcAlert:999877368216825936> trailing")).toBeNull();
    expect(parseOptRoleEmoji("leading <:vrcAlert:999877368216825936>")).toBeNull();
    expect(parseOptRoleEmoji("please use <:vrcAlert:999877368216825936> thanks")).toBeNull();
  });
});

describe("opt-role button custom ids", () => {
  it("round-trips a role snowflake", () => {
    const roleId = "999871775993233488";
    const customId = optRoleButtonCustomId(roleId);
    expect(customId).toBe("opt-role:999871775993233488");
    expect(parseOptRoleButtonCustomId(customId)).toBe(roleId);
  });

  it("rejects unrelated custom ids", () => {
    expect(parseOptRoleButtonCustomId("profile-settings:timezone:1")).toBeNull();
    expect(parseOptRoleButtonCustomId("opt-role:abc")).toBeNull();
  });
});

describe("OPT_ROLE_PRESETS", () => {
  it("covers both Dyno replacement panels with the original roles", () => {
    const eventRoles = OPT_ROLE_PRESETS["event-opt-in"].sections.flatMap((s) =>
      s.buttons.map((b) => b.roleId),
    );
    const optInRoles = OPT_ROLE_PRESETS["opt-in"].sections.flatMap((s) =>
      s.buttons.map((b) => b.roleId),
    );

    expect(eventRoles).toEqual(["999871775993233488", "999871666563850251"]);
    expect(optInRoles).toEqual([
      "999860568431271968",
      "999860674404569242",
      "999860757770543184",
      "999860876062498827",
      "814562269039689778",
    ]);
  });

  it("keeps original custom emotes on every preset button", () => {
    const buttons = Object.values(OPT_ROLE_PRESETS).flatMap((panel) =>
      panel.sections.flatMap((section) => section.buttons),
    );

    expect(buttons.map((b) => formatEmojiMarkdown(b.emoji))).toEqual([
      "<:vrcAlert:999877368216825936>",
      "<:vrcInvite:999877383605723196>",
      "<:1468star:862435339670126592>",
      "<:SHIELD:826263186071879710>",
      "<:EMT:830948626015453224>",
      "<:TRU:830948641853800509>",
      "🎥",
    ]);
  });

  it("requires Shield / EMT / TRU membership for the restricted opt-ins", () => {
    expect(getRequiredRoleIdsForOptIn("999860568431271968")).toEqual([ROLE_SHIELD_MEMBER]);
    expect(getRequiredRoleIdsForOptIn("999860757770543184")).toEqual([ROLE_EMT_MEMBER]);
    expect(getRequiredRoleIdsForOptIn("999860876062498827")).toEqual([ROLE_TRU_MEMBER]);
    expect(getRequiredRoleIdsForOptIn("814562269039689778")).toEqual([]);
    expect(getRequiredRoleIdsForOptIn("999871775993233488")).toEqual([]);
  });
});

describe("getOptInRequirementError", () => {
  it("allows unrestricted roles and members who hold the required role", () => {
    expect(getOptInRequirementError([], "999871775993233488")).toBeNull();
    expect(
      getOptInRequirementError([ROLE_SHIELD_MEMBER], "999860568431271968"),
    ).toBeNull();
  });

  it("blocks Find A Group / EMT / TRU without membership", () => {
    expect(getOptInRequirementError([], "999860568431271968")).toContain(ROLE_SHIELD_MEMBER);
    expect(getOptInRequirementError([], "999860757770543184")).toContain(ROLE_EMT_MEMBER);
    expect(getOptInRequirementError([], "999860876062498827")).toContain(ROLE_TRU_MEMBER);
  });
});

describe("getOptRoleEligibilityError", () => {
  it("allows a ping role with no elevated permissions", () => {
    expect(getOptRoleEligibilityError(eligibilityRole())).toBeNull();
  });

  it("rejects @everyone, managed roles, and Administrator", () => {
    expect(
      getOptRoleEligibilityError(eligibilityRole({ id: "1", guild: { id: "1" } })),
    ).toMatch(/@everyone/);
    expect(getOptRoleEligibilityError(eligibilityRole({ managed: true }))).toMatch(
      /managed/,
    );
    expect(
      getOptRoleEligibilityError(
        eligibilityRole({ permissionsBits: PermissionFlagsBits.Administrator }),
      ),
    ).toMatch(/elevated permissions/);
  });

  it("rejects other sensitive permissions used by the toggle path", () => {
    expect(
      getOptRoleEligibilityError(
        eligibilityRole({ permissionsBits: PermissionFlagsBits.ManageRoles }),
      ),
    ).toMatch(/elevated permissions/);
    expect(
      getOptRoleEligibilityError(
        eligibilityRole({ permissionsBits: SENSITIVE_OPT_ROLE_PERMISSIONS }),
      ),
    ).toMatch(/elevated permissions/);
  });

  it("rejects ManageMessages and MentionEveryone", () => {
    expect(
      getOptRoleEligibilityError(
        eligibilityRole({ permissionsBits: PermissionFlagsBits.ManageMessages }),
      ),
    ).toMatch(/elevated permissions/);
    expect(
      getOptRoleEligibilityError(
        eligibilityRole({ permissionsBits: PermissionFlagsBits.MentionEveryone }),
      ),
    ).toMatch(/elevated permissions/);
  });
});
