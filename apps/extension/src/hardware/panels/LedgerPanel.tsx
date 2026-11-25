import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  LedgerError,
  ledgerMaxPayloadBytes,
  LEDGER_PERMAWEB_INSTALLER_URL,
  LEDGER_PERMAWEB_REQUIRED_MESSAGE,
  LEDGER_MESSAGE_UNSUPPORTED,
  type LedgerTransport,
} from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { connectLedger, LedgerCancelled, ledgerErrorText, withLedgerClient } from "../ledger";
import type { DeviceSignPanel, DeviceSignPanelProps } from "@gleam/app/src/approval/device-panels.tsx";
import { t, useT } from "@gleam/app/src/i18n/index.tsx";

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

export function wrongLedgerMessage(): string {
  return t("extension.ledgerWrongDevice");
}

/** Gleam doesn't ship the Permaweb app, so the refusal links to the wallet that installs it. */
function PermawebRequiredError() {
  const t = useT();
  return (
    <span className="flex flex-col gap-2">
      <span>{t("errors.ledgerPermawebReason")}</span>
      <span>
        {t("extension.permawebInstallPrefix")}
        <a href={LEDGER_PERMAWEB_INSTALLER_URL} target="_blank" rel="noreferrer" className="underline">
          {t("extension.permawebInstallLink")}
        </a>
        {t("extension.permawebInstallSuffix")}
      </span>
    </span>
  );
}

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
    const t = useT();
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
      let signatures: string[] | null = null;
      let failure: ReactNode = null;
      setStep({ kind: "connecting" });
      try {
        signatures = await withLedgerClient(
          openTransport,
          signal,
          {
            pollMs,
            appTimeoutMs,
            keyTimeoutMs,
            onWaiting: (reason) => setStep({ kind: "waiting", reason }),
            appTimeoutMessage: t("extension.ledgerAppNotFound", { app: appName }),
          },
          async ({ client, version }) => {
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
            if (account.address !== wallet.address) throw new LedgerError("owner-mismatch", wrongLedgerMessage());

            const maxBytes = ledgerMaxPayloadBytes(version);
            const signed: string[] = [];
            for (const [index, payload] of payloads.entries()) {
              if (signal.aborted) throw new LedgerCancelled();
              setStep({ kind: "signing", index });
              if (payload.kind === "message") throw new LedgerError("unsupported-payload", LEDGER_MESSAGE_UNSUPPORTED);
              const signature =
                payload.kind === "transaction"
                  ? await client.signTransaction(payload.transaction, { maxBytes })
                  : await client.signDataItem(base64UrlToBytes(payload.raw), { maxBytes });
              signed.push(bytesToBase64Url(signature));
              callbacks.current.onActivity();
            }
            return signed;
          },
        );
      } catch (error) {
        if (!(error instanceof LedgerCancelled) && !signal.aborted) {
          failure =
            error instanceof LedgerError && error.code === "permaweb-app-required"
              ? <PermawebRequiredError />
              : ledgerErrorText(error);
        }
      } finally {
        clearInterval(activity);
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
            {t("extension.ledgerPlugIn", { app: appName })}
          </p>
          <Button type="button" onClick={() => void run()} disabled={busy}>
            {busy ? t("extension.connecting") : t("extension.signOnLedger")}
          </Button>
        </div>
      );
    }

    if (step.kind === "waiting") {
      return (
        <p role="status" className="text-center text-label leading-snug text-muted">
          {step.reason === "key"
            ? t("extension.ledgerGeneratingKey")
            : t("extension.ledgerWaitingForApp", { app: appName })}
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-2">
        {total > 1 ? (
          <p className="text-center text-caption font-semibold text-foreground">
            {t("extension.itemOfTotal", { index: step.index + 1, total })}
          </p>
        ) : null}
        <p role="status" className="text-center text-label leading-snug text-muted">
          {t("extension.ledgerConfirm")}
        </p>
      </div>
    );
  };
}

export const LedgerPanel = createLedgerPanel();
