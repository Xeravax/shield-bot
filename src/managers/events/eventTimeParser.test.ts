import { describe, expect, it } from "vitest";
import { getTimezoneDateParts, timezoneLocalToUtc } from "../../utility/estTime.js";
import { parseEventTime } from "./eventTimeParser.js";

/** Thursday 27 Aug 2026 15:00 UTC — next schedulable week is Tue 1 Sep–Mon 7 Sep EST. */
const REF = new Date("2026-08-27T15:00:00Z");

function localParts(
  input: string,
  timezone: string,
): { weekday: number; hour: number; minute: number } {
  const parsed = parseEventTime(input, { refDate: REF, timezone });
  expect(parsed).not.toBeNull();
  const parts = getTimezoneDateParts(parsed!, timezone);
  return { weekday: parts.weekday, hour: parts.hour, minute: parts.minute };
}

describe("parseEventTime midnight weekday", () => {
  it.each([
    "Sunday 12AM",
    "Sunday 12 AM",
    "Sunday 12:00 AM",
    "Sunday 0AM",
    "Sunday midnight",
  ])("keeps %s on Sunday in Europe/Berlin", (input) => {
    const parts = localParts(input, "Europe/Berlin");
    expect(parts.weekday).toBe(6);
    expect(parts.hour).toBe(0);
    expect(parts.minute).toBe(0);
  });

  it.each(["Sunday 12AM", "Sunday 0AM", "Sunday 12:00 AM"])(
    "keeps %s on Sunday in America/New_York",
    (input) => {
      const parts = localParts(input, "America/New_York");
      expect(parts.weekday).toBe(6);
      expect(parts.hour).toBe(0);
    },
  );

  it("keeps Saturday 12AM on Saturday", () => {
    const parts = localParts("Saturday 12AM", "Europe/Berlin");
    expect(parts.weekday).toBe(5);
    expect(parts.hour).toBe(0);
  });

  it("does not shift Sunday 1AM back a day", () => {
    const parts = localParts("Sunday 1AM", "Europe/Berlin");
    expect(parts.weekday).toBe(6);
    expect(parts.hour).toBe(1);
  });

  it("maps Sunday 12AM Berlin onto the next planning-week Sunday", () => {
    const parsed = parseEventTime("Sunday 12AM", {
      refDate: REF,
      timezone: "Europe/Berlin",
    });
    expect(parsed?.toISOString()).toBe(
      timezoneLocalToUtc("Europe/Berlin", 2026, 9, 6, 0, 0, 0).toISOString(),
    );
  });
});
