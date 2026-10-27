import type { RuntimePort, RuntimeMessage, WalletState } from "@gleam/core";

/**
 * Wraps the UI's runtime port so the page and any approval sheet are gone
 * before the lock screen can show. The page sits above the whole wallet
 * view, so whatever the user locks, resets or auto-locks, `onLocked` has to
 * run first; a reset also runs `onReset`, which wipes the page's site data
 * as well. A lock or reset runs it as the call is made; an auto-lock
 * happens in the worker unseen, so it runs when a `getState` read first
 * reports the session gone, which is the read that moves the app to the
 * lock screen.
 */
export function guardLock<T extends RuntimePort>(runtime: T, onLocked: () => void, onReset: () => void = onLocked): T {
  return {
    ...runtime,
    async send<TPayload, TResponse>(message: RuntimeMessage<TPayload>, target?: string): Promise<TResponse> {
      if (message.type === "lockWallet") onLocked();
      if (message.type === "resetAllWallets") onReset();
      const response = await runtime.send<TPayload, TResponse>(message, target);
      if (message.type === "getState") {
        const state = response as WalletState;
        if (state.session === null || state.session.unlockedWalletIds.length === 0) onLocked();
      }
      return response;
    },
  };
}
