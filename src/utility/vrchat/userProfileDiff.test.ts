import { describe, expect, it } from "vitest";
import {
  cachedVrchatName,
  diffVrchatProfile,
  emptyVrchatProfile,
  formatProfileChange,
  nameChangeFromCache,
  profileChangeTitle,
  readVrchatProfile,
} from "./userProfileDiff.js";

const fullUser = {
  displayName: "BarryWheatlyIII",
  username: "barry",
  pronouns: "he/him",
  status: "active",
  statusDescription: "on patrol",
};

describe("readVrchatProfile", () => {
  it("ignores missing and non-string fields", () => {
    const { values, present } = readVrchatProfile({
      displayName: "Ada",
      status: 1,
      location: "wrld_test",
    });
    expect(values).toEqual({ displayName: "Ada" });
    expect(present.has("displayName")).toBe(true);
    expect(present.has("status")).toBe(false);
    expect(present.has("statusDescription")).toBe(false);
  });
});

describe("diffVrchatProfile", () => {
  it("seeds a new profile without reporting changes", () => {
    const { values, present } = readVrchatProfile(fullUser);
    const result = diffVrchatProfile(null, values, present);
    expect(result.isNew).toBe(true);
    expect(result.changes).toEqual([]);
    expect(result.next.displayName).toBe("BarryWheatlyIII");
    expect(result.next.status).toBe("active");
  });

  it("reports only fields that actually changed", () => {
    const previous = {
      ...emptyVrchatProfile(),
      displayName: "BarryWheatlyIII",
      username: "barry",
      pronouns: "he/him",
      status: "active",
      statusDescription: "on patrol",
    };
    const { values, present } = readVrchatProfile({
      ...fullUser,
      displayName: "BarryWheatlyIII",
      pronouns: "they/them",
      status: "busy",
      statusDescription: "afk",
      location: "wrld_somewhere",
    });
    const result = diffVrchatProfile(previous, values, present);
    expect(result.changes.map((change) => change.field)).toEqual([
      "pronouns",
      "status",
      "statusDescription",
    ]);
    expect(result.next.displayName).toBe("BarryWheatlyIII");
    expect(result.next.username).toBe("barry");
  });

  it("does not clear fields omitted from a partial update", () => {
    const previous = {
      ...emptyVrchatProfile(),
      displayName: "BarryWheatlyIII",
      pronouns: "he/him",
      status: "active",
    };
    const { values, present } = readVrchatProfile({ status: "offline" });
    const result = diffVrchatProfile(previous, values, present);
    expect(result.changes).toEqual([
      {
        field: "status",
        label: "Status",
        from: "active",
        to: "offline",
      },
    ]);
    expect(result.next.displayName).toBe("BarryWheatlyIII");
    expect(result.next.pronouns).toBe("he/him");
  });

  it("treats an empty string as a real clear", () => {
    const previous = {
      ...emptyVrchatProfile(),
      statusDescription: "hello",
    };
    const { values, present } = readVrchatProfile({ statusDescription: "" });
    const result = diffVrchatProfile(previous, values, present);
    expect(result.changes[0]).toMatchObject({
      field: "statusDescription",
      from: "hello",
      to: "",
    });
  });
});

describe("cached username helpers", () => {
  it("prefers display name over username", () => {
    const { values } = readVrchatProfile(fullUser);
    expect(cachedVrchatName(values)).toBe("BarryWheatlyIII");
  });

  it("describes a cache change from the display name when there is no snapshot", () => {
    const { values, present } = readVrchatProfile({
      displayName: "NewName",
      username: "newname",
    });
    expect(nameChangeFromCache("OldName", values, present)).toEqual({
      field: "displayName",
      label: "Display Name",
      from: "OldName",
      to: "NewName",
    });
  });

  it("does not describe a change when the cached name is unchanged", () => {
    const { values, present } = readVrchatProfile({
      displayName: "BarryWheatlyIII",
    });
    expect(nameChangeFromCache("BarryWheatlyIII", values, present)).toBeNull();
  });
});

describe("log formatting", () => {
  it("formats status and a single-field title", () => {
    const change = {
      field: "status" as const,
      label: "Status",
      from: "active",
      to: "offline",
    };
    expect(formatProfileChange(change)).toBe("`Online` → `Offline`");
    expect(profileChangeTitle([change])).toBe("Status Changed");
    expect(
      profileChangeTitle([
        change,
        {
          field: "pronouns",
          label: "Pronouns",
          from: "he/him",
          to: "they/them",
        },
      ]),
    ).toBe("VRChat Profile Updated");
  });
});
