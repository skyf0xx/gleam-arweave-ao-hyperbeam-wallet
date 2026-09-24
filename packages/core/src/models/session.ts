import type { WalletSummary } from "./wallet";

/**
 * Auto-lock timeout options. Default is `never`: "unlocked" must survive
 * service-worker restarts to be honest about that default, which is why
 * session metadata is modeled separately from any in-memory-only
 * implementation detail.
 */
export type AutoLockTimeout = "never" | "immediate" | "5min" | "1hr" | "4hr";

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

/**
 * The aggregate read returned by `getState` — the messaging contract's
 * single "what does the extension currently look like" call.
 */
export interface WalletState {
  wallets: WalletSummary[];
  activeWalletId: string | null;
  session: Session | null;
}
