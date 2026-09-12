import { describe, expect, it } from "vitest";
import { scrubRoleDisplay } from "./scrubRoleDisplay.js";

describe("scrubRoleDisplay", () => {
  it("keeps letters and dots", () => {
    expect(scrubRoleDisplay("Agent.Smith")).toBe("Agent.Smith");
    expect(scrubRoleDisplay("abcXYZ.")).toBe("abcXYZ.");
  });

  it("strips non letter and non-dot characters", () => {
    expect(scrubRoleDisplay("S.H.I.E.L.D. @Admin")).toBe("S.H.I.E.L.D.Admin");
    expect(scrubRoleDisplay("Rank-1 (Lead)")).toBe("RankLead");
    expect(scrubRoleDisplay("**Bold**")).toBe("Bold");
  });

  it("falls back to the original name when everything is stripped", () => {
    expect(scrubRoleDisplay("123")).toBe("123");
    expect(scrubRoleDisplay("@#$")).toBe("@#$");
    expect(scrubRoleDisplay("")).toBe("");
  });
});
