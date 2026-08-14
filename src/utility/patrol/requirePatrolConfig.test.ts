import { describe, expect, it, vi, beforeEach } from "vitest";

const { findUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("../../main.js", () => ({
  prisma: {
    guildSettings: { findUnique },
  },
}));

import {
  requirePatrolCategory,
  requireEnrolledChannels,
  requireAttendanceAutofillConfig,
} from "./requirePatrolConfig.js";

describe("requirePatrolCategory", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("fails when the patrol category is missing", async () => {
    findUnique.mockResolvedValue({ patrolChannelCategoryId: null });
    const result = await requirePatrolCategory("guild-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Patrol category is not configured");
    }
  });

  it("returns the category id", async () => {
    findUnique.mockResolvedValue({ patrolChannelCategoryId: "cat-1" });
    const result = await requirePatrolCategory("guild-1");
    expect(result).toEqual({ ok: true, value: "cat-1" });
  });
});

describe("requireEnrolledChannels", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("fails when enrolled channels are empty", async () => {
    findUnique.mockResolvedValue({ enrolledChannels: [] });
    const result = await requireEnrolledChannels("guild-1");
    expect(result.ok).toBe(false);
  });

  it("returns enrolled channel ids", async () => {
    findUnique.mockResolvedValue({ enrolledChannels: ["c1", "c2"] });
    const result = await requireEnrolledChannels("guild-1");
    expect(result).toEqual({ ok: true, value: ["c1", "c2"] });
  });
});

describe("requireAttendanceAutofillConfig", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("fails on missing category before enrolled channels", async () => {
    findUnique.mockResolvedValue({
      patrolChannelCategoryId: null,
      enrolledChannels: ["c1"],
    });
    const result = await requireAttendanceAutofillConfig("guild-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Patrol category");
    }
  });

  it("fails when enrolled channels are missing", async () => {
    findUnique.mockResolvedValue({
      patrolChannelCategoryId: "cat-1",
      enrolledChannels: [],
    });
    const result = await requireAttendanceAutofillConfig("guild-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("enrolled channels");
    }
  });

  it("returns both config values", async () => {
    findUnique.mockResolvedValue({
      patrolChannelCategoryId: "cat-1",
      enrolledChannels: ["c1", "c2"],
    });
    const result = await requireAttendanceAutofillConfig("guild-1");
    expect(result).toEqual({
      ok: true,
      value: { patrolCategoryId: "cat-1", enrolledChannels: ["c1", "c2"] },
    });
  });
});
