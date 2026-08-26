import { describe, expect, it } from "vitest";
import {
  USER_EXPORT_TOKEN_TTL_MS,
  buildUserExportViewUrl,
  createUserExportToken,
  verifyUserExportToken,
} from "./userExportToken.js";

const SECRET = "test-export-signing-secret-at-least-32-chars";
const OTHER_SECRET = "other-export-signing-secret-at-least-32";
const USER_ID = "123456789012345678";
const NOW = Date.UTC(2026, 7, 27, 0, 0, 0);

describe("createUserExportToken / verifyUserExportToken", () => {
  it("round-trips a valid Discord id", () => {
    const token = createUserExportToken(USER_ID, { now: NOW, secret: SECRET });
    expect(verifyUserExportToken(token, { now: NOW, secret: SECRET })).toEqual({
      discordId: USER_ID,
      exp: Math.floor((NOW + USER_EXPORT_TOKEN_TTL_MS) / 1000),
    });
  });

  it("rejects an expired token", () => {
    const token = createUserExportToken(USER_ID, {
      now: NOW,
      ttlMs: 60_000,
      secret: SECRET,
    });
    expect(
      verifyUserExportToken(token, { now: NOW + 60_001, secret: SECRET }),
    ).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = createUserExportToken(USER_ID, { now: NOW, secret: SECRET });
    const parts = token.split(".");
    parts[1] = "999999999999999999";
    expect(
      verifyUserExportToken(parts.join("."), { now: NOW, secret: SECRET }),
    ).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = createUserExportToken(USER_ID, { now: NOW, secret: SECRET });
    expect(
      verifyUserExportToken(token, { now: NOW, secret: OTHER_SECRET }),
    ).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifyUserExportToken("", { secret: SECRET })).toBeNull();
    expect(verifyUserExportToken("not-a-token", { secret: SECRET })).toBeNull();
    expect(verifyUserExportToken("v1.abc.1.mac", { secret: SECRET })).toBeNull();
  });

  it("rejects invalid Discord ids at creation", () => {
    expect(() =>
      createUserExportToken("not-an-id", { secret: SECRET }),
    ).toThrow("Invalid Discord user id");
  });
});

describe("buildUserExportViewUrl", () => {
  it("appends the token as a query param", () => {
    expect(
      buildUserExportViewUrl("https://api.vrcshield.com/", "v1.token"),
    ).toBe("https://api.vrcshield.com/export?t=v1.token");
  });
});
