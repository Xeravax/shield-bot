import { auditLogManager } from "../../main.js";
import { loggers } from "../logger.js";
import type { LoggingSeverity } from "../../managers/logging/loggingTypes.js";
import type { DashboardSession } from "./session.js";

/**
 * Soft-fail staff forum log for Discord Activity dashboard actions.
 */
export function logDashboardAction(options: {
  guildId: string;
  userId: string;
  displayName: string;
  title: string;
  description?: string;
  severity?: LoggingSeverity;
  fields?: { name: string; value: string; inline?: boolean }[];
}): void {
  void auditLogManager
    .postLog({
      guildId: options.guildId,
      category: "dashboard",
      title: options.title,
      description: options.description ?? null,
      severity: options.severity ?? "info",
      fields: [
        {
          name: "User",
          value: `${options.displayName} (\`${options.userId}\`)`,
          inline: true,
        },
        ...(options.fields ?? []),
      ],
      footer: "Discord Activity dashboard",
    })
    .catch((error) => {
      loggers.bot.debug("Dashboard staff log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

export function logDashboardSessionAction(
  session: DashboardSession,
  title: string,
  description?: string,
  fields?: { name: string; value: string; inline?: boolean }[],
  severity: LoggingSeverity = "info",
): void {
  logDashboardAction({
    guildId: session.guildId,
    userId: session.user.id,
    displayName: session.displayName,
    title,
    description,
    fields,
    severity,
  });
}
