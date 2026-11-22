import { describe, expect, it, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  vrcFindMany: vi.fn(),
  vrcUpdate: vi.fn(),
  assignFindMany: vi.fn(),
  assignDeleteMany: vi.fn(),
}));

vi.mock("../../main.js", () => ({
  prisma: {
    vRChatAccount: { findMany: db.vrcFindMany, update: db.vrcUpdate },
    whitelistRoleAssignment: { findMany: db.assignFindMany, deleteMany: db.assignDeleteMany },
  },
  bot: {},
}));

import { WhitelistManager } from "./whitelistManager.js";

function makeManager() {
  const manager = new WhitelistManager();
  const queue = vi.spyOn(manager, "queueBatchedUpdate").mockImplementation(() => {});
  return { manager, queue };
}

describe("WhitelistManager.applyVrchatDisplayName", () => {
  beforeEach(() => {
    Object.values(db).forEach((fn) => fn.mockReset());
    db.vrcUpdate.mockResolvedValue({});
  });

  it("queues a publish keyed by Discord ID when a verified account's name changes", async () => {
    db.vrcFindMany.mockResolvedValue([
      { id: 1, vrchatUsername: "OldName", accountType: "MAIN", user: { discordId: "d1" } },
    ]);
    const { manager, queue } = makeManager();

    const changed = await manager.applyVrchatDisplayName("usr_1", "NewName", "test");

    expect(changed).toBe(true);
    expect(db.vrcUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ vrchatUsername: "NewName" }) }),
    );
    // Must be the Discord ID, not the VRChat user ID: the batch looks guilds up by Discord ID.
    expect(queue).toHaveBeenCalledWith("d1", expect.stringContaining("OldName → NewName"));
  });

  it("refreshes the timestamp but does not publish when the name is unchanged", async () => {
    db.vrcFindMany.mockResolvedValue([
      { id: 1, vrchatUsername: "Same", accountType: "ALT", user: { discordId: "d1" } },
    ]);
    const { manager, queue } = makeManager();

    expect(await manager.applyVrchatDisplayName("usr_1", "Same", "test")).toBe(false);
    expect(db.vrcUpdate).toHaveBeenCalledTimes(1);
    expect(queue).not.toHaveBeenCalled();
  });

  it("does not publish for accounts still in verification", async () => {
    db.vrcFindMany.mockResolvedValue([
      { id: 1, vrchatUsername: null, accountType: "IN_VERIFICATION", user: { discordId: "d1" } },
    ]);
    const { manager, queue } = makeManager();

    expect(await manager.applyVrchatDisplayName("usr_1", "Name", "test")).toBe(true);
    expect(queue).not.toHaveBeenCalled();
  });
});

describe("WhitelistManager.expireRolesAndPublish", () => {
  beforeEach(() => {
    Object.values(db).forEach((fn) => fn.mockReset());
  });

  it("does nothing when no assignment has expired", async () => {
    db.assignFindMany.mockResolvedValue([]);
    const { manager, queue } = makeManager();

    expect(await manager.expireRolesAndPublish()).toBe(0);
    expect(db.assignDeleteMany).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
  });

  it("deletes expired assignments and queues one publish per user and guild", async () => {
    db.assignFindMany.mockResolvedValue([
      { id: 1, whitelist: { guildId: "g1", user: { discordId: "d1" } } },
      { id: 2, whitelist: { guildId: "g1", user: { discordId: "d1" } } },
      { id: 3, whitelist: { guildId: "g2", user: { discordId: "d1" } } },
      { id: 4, whitelist: { guildId: "g1", user: { discordId: "d2" } } },
    ]);
    db.assignDeleteMany.mockResolvedValue({ count: 4 });
    const { manager, queue } = makeManager();

    expect(await manager.expireRolesAndPublish()).toBe(4);
    expect(db.assignDeleteMany).toHaveBeenCalledWith({ where: { id: { in: [1, 2, 3, 4] } } });
    expect(queue).toHaveBeenCalledTimes(3);
    expect(queue).toHaveBeenCalledWith("d1", expect.any(String), "g1");
    expect(queue).toHaveBeenCalledWith("d1", expect.any(String), "g2");
    expect(queue).toHaveBeenCalledWith("d2", expect.any(String), "g1");
  });
});
