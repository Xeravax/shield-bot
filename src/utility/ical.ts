/** Minimal iCalendar (RFC 5545) helpers — no external dependency. */

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;
const ICAL_LINE_LIMIT = 75;

export function escapeIcalText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/**
 * Fold a content line to RFC 5545's 75-octet limit.
 * Continuation lines start with a single space.
 */
export function foldIcalLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= ICAL_LINE_LIMIT) {
    return line;
  }

  const parts: string[] = [];
  let offset = 0;
  let first = true;
  while (offset < bytes.length) {
    const max = first ? ICAL_LINE_LIMIT : ICAL_LINE_LIMIT - 1;
    let end = Math.min(offset + max, bytes.length);
    // Avoid splitting a multibyte UTF-8 sequence
    while (end > offset && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    if (end === offset) {
      end = Math.min(offset + max, bytes.length);
    }
    const chunk = bytes.subarray(offset, end).toString("utf8");
    parts.push(first ? chunk : ` ${chunk}`);
    offset = end;
    first = false;
  }
  return parts.join("\r\n");
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

function joinIcalLines(lines: string[]): string {
  return lines.map(foldIcalLine).join("\r\n");
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
  return joinIcalLines(lines);
}

export function buildVcalendar(events: IcalEventInput[]): string {
  const body = events.map(buildVevent).join("\r\n");
  const header = joinIcalLines([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//S.H.I.E.L.D.//Discord Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ]);
  const footer = foldIcalLine("END:VCALENDAR");
  if (!body) {
    return `${header}\r\n${footer}\r\n`;
  }
  return `${header}\r\n${body}\r\n${footer}\r\n`;
}
