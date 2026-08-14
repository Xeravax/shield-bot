import type { VerifiedAccount } from "./verification/requireVerifiedAccount.js";
import type { AttendanceAutofillConfig } from "./patrol/requirePatrolConfig.js";

/**
 * Shared bag DiscordX passes as the 4th Guard arg and injects into command methods
 * (after `client`) so Guards can transmit resolved data without a WeakMap stash.
 */
export type AppGuardData = {
  verifiedAccount?: VerifiedAccount;
  vrcGroupId?: string;
  autofillConfig?: AttendanceAutofillConfig;
};

export function requireGuardVerifiedAccount(
  data: AppGuardData,
): VerifiedAccount {
  if (!data.verifiedAccount) {
    throw new Error(
      "VerifiedAccountGuard did not run — programming error.",
    );
  }
  return data.verifiedAccount;
}

export function requireGuardVrcGroupId(data: AppGuardData): string {
  if (data.vrcGroupId === undefined) {
    throw new Error(
      "VrchatGroupConfiguredGuard did not run — programming error.",
    );
  }
  return data.vrcGroupId;
}

export function requireGuardAutofillConfig(
  data: AppGuardData,
): AttendanceAutofillConfig {
  if (!data.autofillConfig) {
    throw new Error(
      "AttendanceAutofillConfigGuard did not run — programming error.",
    );
  }
  return data.autofillConfig;
}
