import { vaultHasPassword, type TimerPort } from "@gleam/core";
import type { WalletLifecycleHandler } from "./handlers/wallet-lifecycle";
import type { LockIndicatorPort } from "./platform";

const AUTO_LOCK_ALARM_NAME = "auto-lock";

/**
 * Auto-lock is otherwise only checked when something reads the session;
 * this tick drops the keys once the timeout passes even if nothing does.
 */
export function registerAutoLockAlarm(timer: TimerPort, enforceAutoLock: () => Promise<unknown>): void {
  timer.every(AUTO_LOCK_ALARM_NAME, 1, () => {
    enforceAutoLock().catch((error: unknown) => console.error("Auto-lock failed.", error));
  });
}

export function createVaultLock(
  lifecycle: Pick<WalletLifecycleHandler, "lockWallet" | "getState" | "getLockSettings">,
  lockIndicator: LockIndicatorPort,
) {
  async function lockVault(): Promise<void> {
    await lifecycle.lockWallet();
    // A vault of only hardware wallets has no password and stays unlocked.
    if (vaultHasPassword((await lifecycle.getState()).wallets)) void lockIndicator.setLocked(true);
  }

  /**
   * Locks when the computer's screen locks, unless auto-lock is "never".
   * Only `"locked"` counts: the auto-lock timeout already runs from the last
   * use of the wallet, which is stricter than the OS's idle state.
   */
  async function lockOnScreenLock(state: string): Promise<void> {
    if (state !== "locked") return;
    if ((await lifecycle.getLockSettings()).autoLockTimeout === "never") return;
    await lockVault();
  }

  return { lockVault, lockOnScreenLock };
}
