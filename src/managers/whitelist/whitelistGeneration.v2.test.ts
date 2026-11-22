import { describe, expect, it, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ settingsFindUnique: vi.fn() }));

vi.mock("../../main.js", () => ({
  prisma: { guildSettings: { findUnique: db.settingsFindUnique } },
}));

import { WhitelistGeneration } from "./whitelistGeneration.js";

function decode(encoded: string, key: string): string {
  const bytes = Buffer.from(encoded, "base64");
  const keyBytes = Buffer.from(key, "utf8");
  for (let i = 0; i < bytes.length; i++) {bytes[i] ^= keyBytes[i % keyBytes.length];}
  return bytes.toString("utf8");
}

describe("WhitelistGeneration v2", () => {
  beforeEach(() => {
    db.settingsFindUnique.mockReset();
    db.settingsFindUnique.mockResolvedValue(null);
    process.env.WHITELIST_XOR_KEY = "TEST_KEY";
  });

  it("merges duplicate names, lower-cases and sorts permissions", async () => {
    const gen = new WhitelistGeneration();
    vi.spyOn(gen, "getWhitelistUsers").mockResolvedValue([
      { vrchatUsername: "Alice, the Janitor", roles: ["Station", "jotm"] },
      { vrchatUsername: "Alice, the Janitor", roles: ["avatar", "station"] },
      { vrchatUsername: "Bob", roles: [] },
      { vrchatUsername: "", roles: ["staff"] },
    ]);

    const users = await gen.generateWhitelistUsersJson("g1");

    expect(users).toEqual({
      "Alice, the Janitor": ["avatar", "jotm", "station"],
      Bob: [],
    });
  });

  it("wraps the JSON in the v1 envelope with a checksum and a stable content hash", async () => {
    const gen = new WhitelistGeneration();
    vi.spyOn(gen, "getWhitelistUsers").mockResolvedValue([{ vrchatUsername: "Bob", roles: ["staff"] }]);

    const a = await gen.generateEncodedWhitelistV2("g1", new Date(1_000_000_000_000));
    const b = await gen.generateEncodedWhitelistV2("g1", new Date(1_000_000_060_000));

    const decoded = decode(a.encoded, "TEST_KEY");
    const sep = decoded.lastIndexOf("|");
    const body = decoded.slice(0, sep);
    const checksum = Number(decoded.slice(sep + 1));
    expect(JSON.parse(body)).toEqual({ v: 2, generatedAt: 1_000_000_000, users: { Bob: ["staff"] } });
    expect(checksum).toBe([...Buffer.from(body, "utf8")].reduce((s, x) => s + x, 0));
    // generatedAt differs, the content hash (ETag) does not
    expect(a.encoded).not.toBe(b.encoded);
    expect(a.contentHash).toBe(b.contentHash);
  });
});
