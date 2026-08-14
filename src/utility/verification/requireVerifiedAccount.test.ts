import { describe, expect, it, vi, beforeEach } from "vitest";

const { findUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("../../main.js", () => ({
  prisma: {
    user: { findUnique },
  },
}));

import {
  requireVerifiedAccount,
  requireVerifiedAccounts,
  type VerifiedAccount,
} from "./requireVerifiedAccount.js";

function makeAccount(
  overrides: Partial<VerifiedAccount> & Pick<VerifiedAccount, "accountType" | "vrcUserId">,
): VerifiedAccount {
  return {
    id: overrides.id ?? 1,
    userId: overrides.userId ?? 10,
    vrchatUsername: overrides.vrchatUsername ?? "User",
    ...overrides,
  };
}

function mockAccounts(accounts: VerifiedAccount[] | null): void {
  if (accounts === null) {
    findUnique.mockResolvedValue(null);
    return;
  }
  findUnique.mockResolvedValue({
    discordId: "discord-1",
    vrchatAccounts: accounts,
  });
}

describe("requireVerifiedAccount", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("fails when the Discord user has no row", async () => {
    mockAccounts(null);
    const result = await requireVerifiedAccount("discord-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("/verify account");
    }
  });

  it("fails when there are no MAIN/ALT accounts", async () => {
    mockAccounts([]);
    const result = await requireVerifiedAccount("discord-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("/verify account");
    }
  });

  it("returns the ALT account when that is the only verified account", async () => {
    const alt = makeAccount({ id: 2, accountType: "ALT", vrcUserId: "usr_alt" });
    mockAccounts([alt]);
    const result = await requireVerifiedAccount("discord-1");
    expect(result).toEqual({ ok: true, value: alt });
  });

  it("prefers MAIN over ALT when requireMain is false", async () => {
    const alt = makeAccount({ id: 1, accountType: "ALT", vrcUserId: "usr_alt" });
    const main = makeAccount({ id: 2, accountType: "MAIN", vrcUserId: "usr_main" });
    mockAccounts([alt, main]);
    const result = await requireVerifiedAccount("discord-1");
    expect(result).toEqual({ ok: true, value: main });
  });

  it("fails ALT-only when requireMain is true", async () => {
    const alt = makeAccount({ id: 2, accountType: "ALT", vrcUserId: "usr_alt" });
    mockAccounts([alt]);
    const result = await requireVerifiedAccount("discord-1", { requireMain: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("MAIN");
      expect(result.message).toContain("/verify account");
    }
  });

  it("returns MAIN when requireMain is true", async () => {
    const main = makeAccount({ id: 3, accountType: "MAIN", vrcUserId: "usr_main" });
    const alt = makeAccount({ id: 4, accountType: "ALT", vrcUserId: "usr_alt" });
    mockAccounts([main, alt]);
    const result = await requireVerifiedAccount("discord-1", { requireMain: true });
    expect(result).toEqual({ ok: true, value: main });
  });
});

describe("requireVerifiedAccounts", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("fails for a target with no verified accounts", async () => {
    mockAccounts([]);
    const result = await requireVerifiedAccounts("target-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("does not have any verified");
      expect(result.message).not.toContain("You don't");
    }
  });

  it("returns all MAIN and ALT accounts", async () => {
    const main = makeAccount({ id: 1, accountType: "MAIN", vrcUserId: "usr_main" });
    const alt = makeAccount({ id: 2, accountType: "ALT", vrcUserId: "usr_alt" });
    mockAccounts([main, alt]);
    const result = await requireVerifiedAccounts("target-1");
    expect(result).toEqual({ ok: true, value: [main, alt] });
  });
});
