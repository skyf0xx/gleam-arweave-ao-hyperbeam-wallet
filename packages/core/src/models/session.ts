import type { WalletSummary } from "./wallet";

/**
 * Auto-lock timeout options. Default is `1hr`. "unlocked" must survive
 * service-worker restarts to honor `never`, which is why session metadata is modeled
 * separately from any in-memory-only implementation detail.
 */
export const AUTO_LOCK_TIMEOUTS = ["never", "immediate", "5min", "1hr", "4hr"] as const;

export type AutoLockTimeout = (typeof AUTO_LOCK_TIMEOUTS)[number];

/**
 * The unlocked state of the extension. Global, not per-Wallet — a
 * Session references zero or more currently-unlocked Wallets. Session
 * metadata belongs in memory-only storage (`chrome.storage.session`);
 * that storage choice is the host adapter's concern, not this model's.
 */
export interface Session {
  unlockedAt: number;
  lastActivityAt: number;
  autoLockTimeout: AutoLockTimeout;
  unlockedWalletIds: string[];
}

export interface LockSettings {
  autoLockTimeout: AutoLockTimeout;
}

export function isLockSettings(value: unknown): value is LockSettings {
  return (
    value !== null &&
    typeof value === "object" &&
    AUTO_LOCK_TIMEOUTS.includes((value as Record<string, unknown>).autoLockTimeout as AutoLockTimeout)
  );
}

/**
 * The aggregate read returned by `getState` — the messaging contract's
 * single "what does the extension currently look like" call.
 */
export interface WalletState {
  wallets: WalletSummary[];
  activeWalletId: string | null;
  session: Session | null;
}
