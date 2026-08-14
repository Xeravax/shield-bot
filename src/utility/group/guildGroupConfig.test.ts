import { describe, expect, it, vi, beforeEach } from "vitest";

const { findUnique, count } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  count: vi.fn(),
}));

vi.mock("../../main.js", () => ({
  prisma: {
    guildSettings: { findUnique },
    groupRoleMapping: { count },
  },
}));

import {
  requireGuildVrcGroupId,
  requireGroupRoleMappings,
} from "./guildGroupConfig.js";

describe("requireGuildVrcGroupId", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("fails when the guild has no settings row", async () => {
    findUnique.mockResolvedValue(null);
    const result = await requireGuildVrcGroupId("guild-1");
    expect(result.ok).toBe(false);
    expect(findUnique).toHaveBeenCalledWith({
      where: { guildId: "guild-1" },
      select: { vrcGroupId: true },
    });
  });

  it("fails when vrcGroupId is null", async () => {
    findUnique.mockResolvedValue({ vrcGroupId: null });
    const result = await requireGuildVrcGroupId("guild-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("No VRChat group configured");
    }
  });

  it("returns the group id scoped to the given guildId", async () => {
    findUnique.mockResolvedValue({ vrcGroupId: "grp_abc" });
    const result = await requireGuildVrcGroupId("guild-42");
    expect(result).toEqual({ ok: true, value: "grp_abc" });
    expect(findUnique).toHaveBeenCalledWith({
      where: { guildId: "guild-42" },
      select: { vrcGroupId: true },
    });
    expect(findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ vrcGroupId: expect.anything() }),
      }),
    );
  });
});

describe("requireGroupRoleMappings", () => {
  beforeEach(() => {
    count.mockReset();
  });

  it("fails when no mappings exist for the guild", async () => {
    count.mockResolvedValue(0);
    const result = await requireGroupRoleMappings("guild-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("/group role map");
    }
    expect(count).toHaveBeenCalledWith({ where: { guildId: "guild-1" } });
  });

  it("returns the mapping count scoped to guildId", async () => {
    count.mockResolvedValue(3);
    const result = await requireGroupRoleMappings("guild-9");
    expect(result).toEqual({ ok: true, value: 3 });
    expect(count).toHaveBeenCalledWith({ where: { guildId: "guild-9" } });
  });
});
