import { describe, expect, it } from "vitest";
import {
  type AppGuardData,
  requireGuardAutofillConfig,
  requireGuardVerifiedAccount,
  requireGuardVrcGroupId,
} from "./guardData.js";
import type { VerifiedAccount } from "./verification/requireVerifiedAccount.js";

const sampleAccount: VerifiedAccount = {
  id: 1,
  userId: 10,
  vrcUserId: "usr_1",
  vrchatUsername: "Test",
  accountType: "MAIN",
};

describe("AppGuardData helpers", () => {
  it("requireGuardVerifiedAccount returns the account when set", () => {
    const data: AppGuardData = { verifiedAccount: sampleAccount };
    expect(requireGuardVerifiedAccount(data)).toEqual(sampleAccount);
  });

  it("requireGuardVerifiedAccount throws when missing", () => {
    expect(() => requireGuardVerifiedAccount({})).toThrow(
      /VerifiedAccountGuard did not run/,
    );
  });

  it("requireGuardVrcGroupId returns the id when set", () => {
    const data: AppGuardData = { vrcGroupId: "grp_abc" };
    expect(requireGuardVrcGroupId(data)).toBe("grp_abc");
  });

  it("requireGuardVrcGroupId throws when missing", () => {
    expect(() => requireGuardVrcGroupId({})).toThrow(
      /VrchatGroupConfiguredGuard did not run/,
    );
  });

  it("requireGuardAutofillConfig returns the config when set", () => {
    const config = {
      patrolCategoryId: "cat_1",
      enrolledChannels: ["ch_1", "ch_2"],
    };
    const data: AppGuardData = { autofillConfig: config };
    expect(requireGuardAutofillConfig(data)).toEqual(config);
  });

  it("requireGuardAutofillConfig throws when missing", () => {
    expect(() => requireGuardAutofillConfig({})).toThrow(
      /AttendanceAutofillConfigGuard did not run/,
    );
  });

  it("allows Guards to accumulate fields on the same bag", () => {
    const data: AppGuardData = {};
    data.verifiedAccount = { ...sampleAccount, accountType: "ALT" };
    data.vrcGroupId = "grp_one";
    expect(requireGuardVerifiedAccount(data).vrcUserId).toBe("usr_1");
    expect(requireGuardVrcGroupId(data)).toBe("grp_one");
  });
});
