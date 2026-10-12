import { useEffect, useRef, useState } from "react";
import {
  LedgerArweaveClient,
  LedgerError,
  type LedgerArweaveApp,
  type LedgerTransport,
  type RuntimePort,
  type WalletSummary,
} from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import {
  connectLedger,
  LedgerCancelled,
  ledgerErrorText,
  waitForLedgerApp,
} from "@/src/hardware/ledger";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import {
  backgroundErrorText,
  ConnectedNotice,
  ConnectShell,
} from "./connect-shared";

export interface LedgerConnectViewProps {
  runtime: RuntimePort;
  /** Swapped in tests, which have no WebHID. */
  openTransport?: () => Promise<LedgerTransport & { model?: string }>;
  onClose?: () => void;
  autoCloseMs?: number;
  pollMs?: number;
  /** How long to wait for the Arweave app to open. */
  appTimeoutMs?: number;
  /** How long to wait for a first-launch key generation. */
  keyTimeoutMs?: number;
}

type Step =
  | { kind: "start" }
  | { kind: "connecting" }
  | { kind: "waiting"; reason: "app" | "key" }
  | { kind: "verify"; address: string }
  | { kind: "name"; account: LedgerDetails }
  | { kind: "error"; message: string }
  | { kind: "done" };

interface LedgerDetails {
  owner: string;
  address: string;
  device: {
    kind: "ledger";
    model?: string;
    appVersion: string;
    app?: LedgerArweaveApp;
  };
}

function addWalletErrorText(error: unknown): string {
  const text = backgroundErrorText(error);
  const duplicate =
    /already in Gleam as (?:the hardware wallet )?"([^"]+)"/.exec(text);
  return duplicate
    ? `This Ledger is already in Gleam as "${duplicate[1]}".`
    : text;
}

export function LedgerConnectView({
  runtime,
  openTransport = connectLedger,
  onClose = () => window.close(),
  autoCloseMs = 3000,
  pollMs = 750,
  appTimeoutMs = 30_000,
  keyTimeoutMs = 10 * 60_000,
}: LedgerConnectViewProps) {
  const [step, setStep] = useState<Step>({ kind: "start" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (step.kind !== "done") return;
    const timer = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(timer);
  }, [step.kind, onClose, autoCloseMs]);

  const start = async () => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const { signal } = abort;
    let transport: (LedgerTransport & { model?: string }) | null = null;
    setStep({ kind: "connecting" });
    try {
      const opened = await openTransport();
      transport = opened;
      // Closing is what interrupts an exchange the user is still confirming on the device.
      signal.addEventListener(
        "abort",
        () => void opened.close().catch(() => undefined),
        { once: true },
      );
      if (signal.aborted) throw new LedgerCancelled();
      const client = new LedgerArweaveClient(transport);

      const version = await waitForLedgerApp(client, {
        signal,
        pollMs,
        appTimeoutMs,
        keyTimeoutMs,
        onWaiting: (reason) => setStep({ kind: "waiting", reason }),
        appTimeoutMessage:
          "Gleam couldn't find the Arweave app. Unlock your Ledger, open the Arweave app and try again.",
      });

      let app: LedgerArweaveApp | undefined;
      try {
        app = (await client.getAppInfo()).app ?? undefined;
      } catch (e) {
        if (!(e instanceof LedgerError)) throw e;
      }

      const address = await client.getAddress();
      if (signal.aborted) throw new LedgerCancelled();
      setStep({ kind: "verify", address });
      const account = await client.getAccount({ verify: true });
      if (signal.aborted) throw new LedgerCancelled();

      setStep({
        kind: "name",
        account: {
          owner: account.owner,
          address: account.address,
          device: {
            kind: "ledger",
            ...(transport.model ? { model: transport.model } : {}),
            appVersion: `${version.major}.${version.minor}.${version.patch}`,
            ...(app ? { app } : {}),
          },
        },
      });
    } catch (e) {
      if (e instanceof LedgerCancelled || signal.aborted) {
        setStep({ kind: "start" });
      } else {
        setStep({ kind: "error", message: ledgerErrorText(e) });
      }
    } finally {
      await transport?.close().catch(() => undefined);
    }
  };

  const cancel = () => abortRef.current?.abort();

  return (
    <ConnectShell title="Connect Ledger">
      {step.kind === "start" || step.kind === "connecting" ? (
        <StartStep
          busy={step.kind === "connecting"}
          onConnect={() => void start()}
        />
      ) : null}
      {step.kind === "waiting" ? (
        <WaitingStep reason={step.reason} onCancel={cancel} />
      ) : null}
      {step.kind === "verify" ? (
        <VerifyStep address={step.address} onCancel={cancel} />
      ) : null}
      {step.kind === "name" ? (
        <NameStep
          runtime={runtime}
          account={step.account}
          onConnected={() => setStep({ kind: "done" })}
        />
      ) : null}
      {step.kind === "error" ? (
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-body leading-relaxed text-warning">
            {step.message}
          </p>
          <Button type="button" onClick={() => setStep({ kind: "start" })}>
            Try again
          </Button>
        </div>
      ) : null}
      {step.kind === "done" ? (
        <ConnectedNotice device="Ledger" onClose={onClose} />
      ) : null}
    </ConnectShell>
  );
}

function StartStep({
  busy,
  onConnect,
}: {
  busy: boolean;
  onConnect: () => void;
}) {
  return (
    <>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-body leading-relaxed text-muted">
        <li>Plug in your Ledger and unlock it.</li>
        <li>Open the Arweave app.</li>
        <li>Press Connect and choose your Ledger in the browser prompt.</li>
      </ol>
      <Button type="button" onClick={onConnect} disabled={busy}>
        {busy ? "Connecting…" : "Connect"}
      </Button>
    </>
  );
}

function WaitingStep({
  reason,
  onCancel,
}: {
  reason: "app" | "key";
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-body leading-relaxed">
        {reason === "key"
          ? "Your Ledger is generating its Arweave key. This happens once per recovery phrase and can take several minutes. Keep it plugged in and the app open."
          : "Waiting for the Arweave app. Unlock your Ledger and open the Arweave app."}
      </p>
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function VerifyStep({
  address,
  onCancel,
}: {
  address: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-body leading-relaxed">
        Check the address on your Ledger matches:
      </p>
      <span className="break-all font-mono text-label text-foreground">
        {address}
      </span>
      <p className="text-caption text-muted">
        Approve it on the device to continue.
      </p>
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function NameStep({
  runtime,
  account,
  onConnected,
}: {
  runtime: RuntimePort;
  account: LedgerDetails;
  onConnected: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await runtime.send<unknown, WalletSummary>({
        type: "addHardwareWallet",
        payload: {
          method: "ledger",
          publicKey: account.owner,
          device: account.device,
          ...(name.trim() ? { name: name.trim() } : {}),
        },
      });
      onConnected();
    } catch (e) {
      setError(addWalletErrorText(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-muted">Address</span>
        <span
          title={account.address}
          className="font-mono text-label text-foreground"
        >
          {truncateAddress(account.address)}
        </span>
      </div>
      <TextField
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Ledger"
        maxLength={40}
        autoComplete="off"
      />
      {error ? (
        <p role="alert" className="text-caption leading-snug text-warning">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        onClick={() => void connect()}
        disabled={submitting}
      >
        {submitting ? "Connecting…" : "Connect"}
      </Button>
    </div>
  );
}
