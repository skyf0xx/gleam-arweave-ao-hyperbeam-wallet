import { dappError } from "./dapp-error";

export function requireWebOrigin(origin: unknown): string {
  if (typeof origin === "string") {
    try {
      const url = new URL(origin);
      if ((url.protocol === "https:" || url.protocol === "http:") && url.origin === origin) return origin;
    } catch {
      // Falls through to the error below.
    }
  }
  throw new Error(dappError("Expected a web origin such as https://example.com."));
}

/**
 * `TransferDraft` types `walletId` as optional. Every real
 * caller (`SendView`) always supplies it, but the wire type
 * itself can't promise that — this guard turns a missing field into a
 * named rejection rather than `undefined` silently reaching the
 * key-session lookup as a wallet id. The request carries no signing
 * material — see `key-session.ts`.
 */
export function requireWalletId<T extends { walletId?: string }>(draft: T): T & { walletId: string } {
  if (!draft.walletId) {
    throw new Error(dappError("This action requires a wallet id."));
  }
  return draft as T & { walletId: string };
}
