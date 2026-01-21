/**
 * Parse human-readable duration strings to milliseconds
 * Supports formats like "1 week", "2 weeks", "1 month", "30 days", etc.
 */

/**
 * Parse a duration string to milliseconds
 * @param durationString - Duration string (e.g., "1 week", "2 months", "30 days")
 * @returns Duration in milliseconds, or null if invalid
 */
export function parseDurationToMs(durationString: string): number | null {
  const normalized = durationString.trim().toLowerCase();

  // Match patterns like "2 weeks", "2w", "14 days", "14d", "1 month", "1mo"
  const patterns = [
    // Weeks
    { regex: /^(\d+)\s*(?:weeks?|w)$/, multiplier: 7 * 24 * 60 * 60 * 1000 },
    // Days
    { regex: /^(\d+)\s*(?:days?|d)$/, multiplier: 24 * 60 * 60 * 1000 },
    // Months (approximate, 30 days)
    { regex: /^(\d+)\s*(?:months?|mo)$/, multiplier: 30 * 24 * 60 * 60 * 1000 },
    // Years (approximate, 365 days)
    { regex: /^(\d+)\s*(?:years?|y)$/, multiplier: 365 * 24 * 60 * 60 * 1000 },
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (match) {
      const value = parseInt(match[1], 10);
      if (value <= 0) {
        return null;
      }
      return value * pattern.multiplier;
    }
  }

  return null;
}

/**
 * Check if a duration string is valid
 * @param durationString - Duration string to validate
 * @returns True if valid, false otherwise
 */
export function isValidDuration(durationString: string): boolean {
  return parseDurationToMs(durationString) !== null;
}

/**
 * Convert milliseconds to a human-readable duration string
 * @param ms - Milliseconds
 * @returns Human-readable string (e.g., "1 week 1 day", "2 months 5 days")
 */
export function msToDurationString(ms: number): string {
  if (ms < 0) {
    return "0 days";
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const msPerWeek = 7 * msPerDay;
  const msPerMonth = 30 * msPerDay;
  const msPerYear = 365 * msPerDay;

  let remaining = ms;
  const parts: string[] = [];

  // Years
  const years = Math.floor(remaining / msPerYear);
  if (years > 0) {
    parts.push(`${years} ${years === 1 ? "year" : "years"}`);
    remaining = remaining % msPerYear;
  }

  // Months
  const months = Math.floor(remaining / msPerMonth);
  if (months > 0) {
    parts.push(`${months} ${months === 1 ? "month" : "months"}`);
    remaining = remaining % msPerMonth;
  }

  // Weeks
  const weeks = Math.floor(remaining / msPerWeek);
  if (weeks > 0) {
    parts.push(`${weeks} ${weeks === 1 ? "week" : "weeks"}`);
    remaining = remaining % msPerWeek;
  }

  // Days
  const days = Math.floor(remaining / msPerDay);
  if (days > 0) {
    parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  }

  if (parts.length === 0) {
    return "0 days";
  }

  return parts.join(" ");
}
