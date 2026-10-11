import { LedgerError, type LedgerAppVersion, type LedgerArweaveClient } from "@gleam/core";
import { LedgerTransportError } from "./webhid-transport";

/** Thrown when the caller's signal aborts a Ledger flow. */
export class LedgerCancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "LedgerCancelled";
  }
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new LedgerCancelled());
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LedgerCancelled());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function ledgerErrorText(error: unknown): string {
  if (error instanceof LedgerError || error instanceof LedgerTransportError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return message || "Something went wrong talking to the Ledger.";
}

export type LedgerWaitReason = "app" | "key";

export interface WaitForLedgerAppOptions {
  signal: AbortSignal;
  pollMs: number;
  /** How long to wait for the app to open. */
  appTimeoutMs: number;
  /** How long to wait for a first-launch key generation, which replaces the app deadline once seen. */
  keyTimeoutMs: number;
  onWaiting(reason: LedgerWaitReason): void;
  /** Copy for giving up on the app; the device's own message otherwise. */
  appTimeoutMessage: string;
}

/**
 * Polls GET_VERSION until the Arweave (or Permaweb) app answers. A locked
 * device or the dashboard means the app isn't open yet; 0x6987 means the
 * app is still generating its RSA key, which can take minutes on first
 * launch.
 */
export async function waitForLedgerApp(
  client: LedgerArweaveClient,
  { signal, pollMs, appTimeoutMs, keyTimeoutMs, onWaiting, appTimeoutMessage }: WaitForLedgerAppOptions,
): Promise<LedgerAppVersion> {
  let deadline = Date.now() + appTimeoutMs;
  let keyWait = false;
  for (;;) {
    try {
      return await client.getVersion();
    } catch (error) {
      if (signal.aborted) throw new LedgerCancelled();
      if (!(error instanceof LedgerError)) throw error;
      if (error.code === "key-not-ready") {
        if (!keyWait) {
          keyWait = true;
          deadline = Date.now() + keyTimeoutMs;
        }
        onWaiting("key");
      } else if (error.code === "app-not-open" || error.code === "device-locked") {
        if (!keyWait) onWaiting("app");
      } else {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw keyWait ? error : new LedgerError(error.code, appTimeoutMessage);
      }
      await abortableSleep(pollMs, signal);
    }
  }
}
