import { describe, expect, it } from "vitest";
import {
  OPT_ROLE_PRESETS,
  formatEmojiMarkdown,
  optRoleButtonCustomId,
  parseOptRoleButtonCustomId,
  parseOptRoleEmoji,
} from "./optRolePanel.js";

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
      "999860876062498827",
      "999860757770543184",
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
});
