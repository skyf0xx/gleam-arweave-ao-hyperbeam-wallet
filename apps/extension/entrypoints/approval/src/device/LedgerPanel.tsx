import { useEffect, useRef, useState } from "react";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  LedgerArweaveClient,
  LedgerError,
  ledgerMaxPayloadBytes,
  LEDGER_PERMAWEB_REQUIRED_MESSAGE,
  type LedgerTransport,
} from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { connectLedger, LedgerCancelled, ledgerErrorText, waitForLedgerApp } from "@/src/hardware/ledger";
import type { DeviceSignPanel, DeviceSignPanelProps } from "./device-panels";

export interface LedgerPanelOptions {
  /** Swapped in tests, which have no WebHID. */
  openTransport?: () => Promise<LedgerTransport>;
  pollMs?: number;
  appTimeoutMs?: number;
  keyTimeoutMs?: number;
  /** How often to tell the background the device is still working. */
  activityMs?: number;
}

type Step =
  | { kind: "start" }
  | { kind: "connecting" }
  | { kind: "waiting"; reason: "app" | "key" }
  | { kind: "signing"; index: number };

export const WRONG_LEDGER_MESSAGE = "This is a different Ledger than the one connected to this wallet.";

/**
 * Signs every payload over WebHID, in order. WebHID's device chooser
 * needs a user gesture, so nothing touches the device until the button
 * is pressed. Unmounting (Cancel, an error shown by the parent, the
 * window closing) aborts the run and closes the transport, which is
 * what interrupts an exchange still waiting on the device.
 */
export function createLedgerPanel({
  openTransport = connectLedger,
  pollMs = 750,
  appTimeoutMs = 30_000,
  keyTimeoutMs = 10 * 60_000,
  activityMs = 30_000,
}: LedgerPanelOptions = {}): DeviceSignPanel {
  return function LedgerPanel({ payloads, wallet, onSignatures, onActivity, onError }: DeviceSignPanelProps) {
    const [step, setStep] = useState<Step>({ kind: "start" });
    const abortRef = useRef<AbortController | null>(null);
    const callbacks = useRef({ onSignatures, onActivity, onError });
    callbacks.current = { onSignatures, onActivity, onError };

    useEffect(() => () => abortRef.current?.abort(), []);

    const needsPermaweb = payloads.some((payload) => payload.kind === "dataItem");
    const appName = needsPermaweb ? "Permaweb" : "Arweave";
    const total = payloads.length;

    const run = async () => {
      const abort = new AbortController();
      abortRef.current = abort;
      const { signal } = abort;
      const activity = setInterval(() => callbacks.current.onActivity(), activityMs);
      let transport: LedgerTransport | null = null;
      let signatures: string[] | null = null;
      let failure: string | null = null;
      setStep({ kind: "connecting" });
      try {
        const opened = await openTransport();
        transport = opened;
        signal.addEventListener("abort", () => void opened.close().catch(() => undefined), { once: true });
        if (signal.aborted) throw new LedgerCancelled();
        const client = new LedgerArweaveClient(opened);

        const version = await waitForLedgerApp(client, {
          signal,
          pollMs,
          appTimeoutMs,
          keyTimeoutMs,
          onWaiting: (reason) => setStep({ kind: "waiting", reason }),
          appTimeoutMessage: `Gleam couldn't find the ${appName} app. Unlock your Ledger, open the ${appName} app and try again.`,
        });

        if (needsPermaweb) {
          let app: string | null = null;
          try {
            app = (await client.getAppInfo()).app;
          } catch (error) {
            // Older firmware may not answer; signDataItem checks the app again itself.
            if (!(error instanceof LedgerError)) throw error;
          }
          if (app === "Arweave") throw new LedgerError("permaweb-app-required", LEDGER_PERMAWEB_REQUIRED_MESSAGE);
        }

        const account = await client.getAccount();
        if (account.address !== wallet.address) throw new LedgerError("owner-mismatch", WRONG_LEDGER_MESSAGE);

        const maxBytes = ledgerMaxPayloadBytes(version);
        const signed: string[] = [];
        for (const [index, payload] of payloads.entries()) {
          if (signal.aborted) throw new LedgerCancelled();
          setStep({ kind: "signing", index });
          const signature =
            payload.kind === "transaction"
              ? await client.signTransaction(payload.transaction, { maxBytes })
              : await client.signDataItem(base64UrlToBytes(payload.raw), { maxBytes });
          signed.push(bytesToBase64Url(signature));
          callbacks.current.onActivity();
        }
        signatures = signed;
      } catch (error) {
        if (!(error instanceof LedgerCancelled) && !signal.aborted) {
          failure = ledgerErrorText(error);
        }
      } finally {
        clearInterval(activity);
        await transport?.close().catch(() => undefined);
      }
      if (signal.aborted) return;
      if (signatures) callbacks.current.onSignatures(signatures);
      else if (failure) callbacks.current.onError(failure);
    };

    if (step.kind === "start" || step.kind === "connecting") {
      const busy = step.kind === "connecting";
      return (
        <div className="flex flex-col gap-4">
          <p className="text-center text-label leading-snug text-muted">
            Plug in your Ledger, unlock it and open the {appName} app.
          </p>
          <Button type="button" onClick={() => void run()} disabled={busy}>
            {busy ? "Connecting…" : "Sign on Ledger"}
          </Button>
        </div>
      );
    }

    if (step.kind === "waiting") {
      return (
        <p role="status" className="text-center text-label leading-snug text-muted">
          {step.reason === "key"
            ? "Your Ledger is generating its Arweave key. This happens once per recovery phrase and can take several minutes. Keep it plugged in and the app open."
            : `Waiting for the ${appName} app. Unlock your Ledger and open the ${appName} app.`}
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-2">
        {total > 1 ? (
          <p className="text-center text-caption font-semibold text-foreground">
            Item {step.index + 1} of {total}
          </p>
        ) : null}
        <p role="status" className="text-center text-label leading-snug text-muted">
          Confirm on your Ledger. Check that it shows the details above.
        </p>
      </div>
    );
  };
}

export const LedgerPanel = createLedgerPanel();
