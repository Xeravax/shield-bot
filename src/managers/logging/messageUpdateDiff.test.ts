import { describe, expect, it } from "vitest";
import {
  analyzeMessageUpdate,
  snapshotFromArchive,
  snapshotFromLiveMessage,
  type MessageEditSnapshot,
} from "./messageUpdateDiff.js";

const NOW = new Date("2026-10-08T16:38:00.000Z");
const YEARS_AGO = new Date("2021-09-01T00:00:00.000Z");
const JUST_NOW = new Date("2026-10-08T16:37:30.000Z");

function snap(overrides: Partial<MessageEditSnapshot> = {}): MessageEditSnapshot {
  return {
    content: "",
    attachments: [],
    embeds: [],
    stickers: [],
    components: [],
    pinned: false,
    flags: [],
    poll: null,
    ...overrides,
  };
}

const linkEmbed = {
  type: "rich",
  title: "Patrol",
  url: "https://vrch.at/nqrz2ms6",
  description: "Join the instance",
  image: {
    url: "https://cdn.example/patrol.png",
    proxyURL: "https://images.discord/old",
    width: 16,
    height: 16,
  },
};

describe("analyzeMessageUpdate", () => {
  it("ignores an uncached gateway update when nothing was edited", () => {
    const result = analyzeMessageUpdate({
      previous: null,
      next: snap({ content: "I cought Mud" }),
      editedAt: null,
      now: NOW,
    });

    expect(result).toEqual({ shouldLog: false });
  });

  it("ignores an uncached update of a message last edited years ago", () => {
    const result = analyzeMessageUpdate({
      previous: null,
      next: snap({
        content: "Your MUDDKING has ran into a problem",
        embeds: [linkEmbed],
      }),
      editedAt: YEARS_AGO,
      now: NOW,
    });

    expect(result).toEqual({ shouldLog: false });
  });

  it("logs a fresh edit when the previous version was not cached, without an empty before", () => {
    const result = analyzeMessageUpdate({
      previous: null,
      next: snap({ content: "updated caption" }),
      editedAt: JUST_NOW,
      now: NOW,
    });

    expect(result.shouldLog).toBe(true);
    if (!result.shouldLog) {
      return;
    }
    expect(result.title).toBe("Message Edited");
    expect(result.fields.map((field) => field.name)).not.toContain("Content before");
    expect(result.fields.find((field) => field.name === "Why")?.value).toMatch(/previous version was not/i);
    expect(result.fields.find((field) => field.name === "Current content")?.value).toBe(
      "updated caption",
    );
  });

  it("ignores an embed media reload when the saved message is otherwise identical", () => {
    const previous = snapshotFromArchive({
      content: "https://vrch.at/nqrz2ms6",
      attachments: [],
      embeds: [linkEmbed],
      stickers: [],
    });
    const next = snap({
      content: previous.content,
      embeds: [
        {
          ...linkEmbed,
          image: {
            url: "https://cdn.example/patrol.png",
            proxyURL: "https://images.discord/new",
            width: 1280,
            height: 720,
          },
        },
      ],
    });

    expect(
      analyzeMessageUpdate({
        previous,
        next,
        editedAt: null,
        now: NOW,
      }),
    ).toEqual({ shouldLog: false });
  });

  it("describes a real content edit", () => {
    const result = analyzeMessageUpdate({
      previous: snap({ content: "before text" }),
      next: snap({ content: "after text" }),
      editedAt: JUST_NOW,
      now: NOW,
    });

    expect(result.shouldLog).toBe(true);
    if (!result.shouldLog) {
      return;
    }
    expect(result.title).toBe("Message Edited");
    expect(result.severity).toBe("warn");
    expect(result.fields.find((field) => field.name === "Content before")?.value).toBe("before text");
    expect(result.fields.find((field) => field.name === "Content after")?.value).toBe("after text");
    expect(result.fields.find((field) => field.name === "Why")?.value).toMatch(/message text changed/i);
  });

  it("describes an added link preview without claiming the text changed", () => {
    const result = analyzeMessageUpdate({
      previous: snap({ content: "https://vrch.at/nqrz2ms6" }),
      next: snap({ content: "https://vrch.at/nqrz2ms6", embeds: [linkEmbed] }),
      editedAt: null,
      now: NOW,
    });

    expect(result.shouldLog).toBe(true);
    if (!result.shouldLog) {
      return;
    }
    expect(result.title).toBe("Message Embed Updated");
    expect(result.severity).toBe("info");
    expect(result.fields.find((field) => field.name === "Embeds")?.value).toMatch(/Added: Patrol/);
    expect(result.fields.find((field) => field.name === "Why")?.value).toMatch(/link preview/i);
    expect(result.fields.map((field) => field.name)).not.toContain("Content before");
  });

  it("ignores a pin-only update", () => {
    const result = analyzeMessageUpdate({
      previous: snap({ content: "hello", pinned: false }),
      next: snap({ content: "hello", pinned: true }),
      editedAt: JUST_NOW,
      now: NOW,
    });

    expect(result).toEqual({ shouldLog: false });
  });

  it("ignores poll vote counts and logs finalization", () => {
    const answer = { id: 1, text: "Yes", emoji: null };
    const live = (voteCount: number, finalized = false) =>
      snapshotFromLiveMessage({
        content: "vote",
        poll: {
          question: { text: "Ready?" },
          allowMultiselect: false,
          resultsFinalized: finalized,
          answers: [{ ...answer, voteCount }],
        },
      });
    const previous = live(1);
    const voted = live(40);
    const finalized = live(40, true);

    expect(
      analyzeMessageUpdate({ previous, next: voted, editedAt: JUST_NOW, now: NOW }),
    ).toEqual({ shouldLog: false });

    const result = analyzeMessageUpdate({
      previous,
      next: finalized,
      editedAt: JUST_NOW,
      now: NOW,
    });
    expect(result.shouldLog).toBe(true);
    if (!result.shouldLog) {
      return;
    }
    expect(result.title).toBe("Poll Updated");
    expect(result.fields.find((field) => field.name === "Poll")?.value).toMatch(/finalized/i);
    expect(result.fields.find((field) => field.name === "Why")?.value).toMatch(/Vote counts alone are ignored/);
  });

  it("describes attachment and flag changes", () => {
    const result = analyzeMessageUpdate({
      previous: snap({
        content: "screenshot",
        attachments: [{ id: "1", name: "old.jpg", size: 10, contentType: "image/jpeg" }],
        flags: [],
      }),
      next: snap({
        content: "screenshot",
        attachments: [{ id: "2", name: "new.jpg", size: 20, contentType: "image/jpeg" }],
        flags: ["SuppressEmbeds"],
      }),
      editedAt: JUST_NOW,
      now: NOW,
    });

    expect(result.shouldLog).toBe(true);
    if (!result.shouldLog) {
      return;
    }
    expect(result.fields.find((field) => field.name === "Attachments")?.value).toMatch(/Removed: old.jpg/);
    expect(result.fields.find((field) => field.name === "Attachments")?.value).toMatch(/Added: new.jpg/);
    expect(result.fields.find((field) => field.name === "Flags")?.value).toMatch(/suppress embeds/i);
    expect(result.fields.find((field) => field.name === "Why")?.value).toMatch(/attachment/i);
    expect(result.fields.find((field) => field.name === "Why")?.value).toMatch(/flags/i);
  });

  it("does not treat a blank archived body plus a stale timestamp as a content edit", () => {
    const result = analyzeMessageUpdate({
      previous: snap({ content: "" }),
      next: snap({ content: "the original text was always here" }),
      editedAt: YEARS_AGO,
      now: NOW,
    });

    expect(result).toEqual({ shouldLog: false });
  });
});
