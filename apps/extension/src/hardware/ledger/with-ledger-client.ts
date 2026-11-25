import { LedgerArweaveClient, type LedgerAppVersion, type LedgerTransport } from "@gleam/core";
import { LedgerCancelled, waitForLedgerApp, type WaitForLedgerAppOptions } from "./wait-for-app";

/**
 * Opens the device, waits for the Arweave app and runs `run` with it. The
 * transport closes when `run` ends, and as soon as `signal` aborts, which
 * is what interrupts an exchange the user is still confirming on the device.
 */
export async function withLedgerClient<T extends LedgerTransport, R>(
  openTransport: () => Promise<T>,
  signal: AbortSignal,
  options: Omit<WaitForLedgerAppOptions, "signal">,
  run: (session: { client: LedgerArweaveClient; version: LedgerAppVersion; transport: T }) => Promise<R>,
): Promise<R> {
  let transport: T | null = null;
  try {
    const opened = await openTransport();
    transport = opened;
    signal.addEventListener("abort", () => void opened.close().catch(() => undefined), { once: true });
    if (signal.aborted) throw new LedgerCancelled();
    const client = new LedgerArweaveClient(opened);
    const version = await waitForLedgerApp(client, { signal, ...options });
    return await run({ client, version, transport: opened });
  } finally {
    await transport?.close().catch(() => undefined);
  }
}
