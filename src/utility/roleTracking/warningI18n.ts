import { DEFAULT_LOCALE, t } from "../../i18n/index.js";

/** Stored in GuildSettings when the guild uses the catalog default weekly warning. */
export const ROLE_TRACKING_DEFAULT_WARNING_MARKER =
  "__i18n:roleTracking.defaultWeeklyWarning__";

const LEGACY_DEFAULT_WARNING_RE =
  /^Hello! This is your Week (\d+) reminder for the \{roleName\} role\. You have (\d+) week(?:s)? remaining\./;

/** True when stored message should be rendered from the i18n catalog. */
export function isCatalogDefaultWarning(message: string): boolean {
  return (
    message === ROLE_TRACKING_DEFAULT_WARNING_MARKER ||
    LEGACY_DEFAULT_WARNING_RE.test(message)
  );
}

/**
 * Resolve warning body text for DM send.
 * Catalog defaults use locale; custom text is returned as-is (placeholders intact).
 */
export function resolveRoleTrackingWarningMessage(
  storedMessage: string,
  locale: string | null | undefined,
  vars: {
    week: number;
    remaining: number;
    roleName: string;
  },
): string {
  if (isCatalogDefaultWarning(storedMessage)) {
    return t(locale ?? DEFAULT_LOCALE, "roleTracking.defaultWeeklyWarning", {
      count: vars.remaining,
      week: vars.week,
      remaining: vars.remaining,
      roleName: "{roleName}",
    });
  }
  return storedMessage;
}

/**
 * Extract week number from offset string like "3 weeks" or from legacy message.
 */
export function weekNumberFromWarning(warning: {
  offset?: string;
  index?: number;
  message?: string;
}): number {
  if (warning.offset) {
    const m = warning.offset.match(/^(\d+)/);
    if (m) return Number(m[1]);
  }
  if (typeof warning.index === "number") {
    return warning.index + 1;
  }
  if (warning.message) {
    const m = warning.message.match(/Week (\d+)/i);
    if (m) return Number(m[1]);
  }
  return 1;
}
