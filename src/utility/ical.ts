/** Minimal iCalendar (RFC 5545) helpers — no external dependency. */

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

export function escapeIcalText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

export function formatIcalUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

/** Strip Discord mention / emoji markup for calendar descriptions. */
export function stripDiscordMarkup(text: string): string {
  return text
    .replace(/<@!?\d+>/g, "")
    .replace(/<@&\d+>/g, "")
    .replace(/<#\d+>/g, "")
    .replace(/<a?:\w+:\d+>/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface IcalEventInput {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  start: Date;
  end?: Date;
  stamp?: Date;
}

export function buildVevent(input: IcalEventInput): string {
  const start = input.start;
  const end =
    input.end ?? new Date(start.getTime() + DEFAULT_DURATION_MS);
  const stamp = input.stamp ?? new Date();

  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeIcalText(input.uid)}`,
    `DTSTAMP:${formatIcalUtc(stamp)}`,
    `DTSTART:${formatIcalUtc(start)}`,
    `DTEND:${formatIcalUtc(end)}`,
    `SUMMARY:${escapeIcalText(input.summary)}`,
    "STATUS:CONFIRMED",
  ];

  if (input.description) {
    lines.push(`DESCRIPTION:${escapeIcalText(input.description)}`);
  }
  if (input.location) {
    lines.push(`LOCATION:${escapeIcalText(input.location)}`);
  }
  if (input.url) {
    lines.push(`URL:${escapeIcalText(input.url)}`);
  }

  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

export function buildVcalendar(events: IcalEventInput[]): string {
  const body = events.map(buildVevent).join("\r\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//S.H.I.E.L.D.//Discord Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (body) {
    lines.push(body);
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
