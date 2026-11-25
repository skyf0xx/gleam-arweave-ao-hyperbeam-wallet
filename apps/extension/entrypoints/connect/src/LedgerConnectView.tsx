import { useEffect, useRef, useState } from "react";
import {
  errorMessage,
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
  withLedgerClient,
} from "@/src/hardware/ledger";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import {
  backgroundErrorText,
  ConnectedNotice,
  ConnectShell,
  useAutoClose,
} from "./connect-shared";
import { t, useT } from "@gleam/app/src/i18n/index.tsx";

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
  const message = errorMessage(error);
  const duplicate =
    /already in Gleam as (?:the hardware wallet )?"([^"]+)"/.exec(message);
  return duplicate
    ? t("extension.ledgerDuplicate", { name: duplicate[1]! })
    : backgroundErrorText(error);
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
  const t = useT();
  const [step, setStep] = useState<Step>({ kind: "start" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useAutoClose(step.kind === "done", onClose, autoCloseMs);

  const start = async () => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const { signal } = abort;
    setStep({ kind: "connecting" });
    try {
      await withLedgerClient(
        openTransport,
        signal,
        {
          pollMs,
          appTimeoutMs,
          keyTimeoutMs,
          onWaiting: (reason) => setStep({ kind: "waiting", reason }),
          appTimeoutMessage: t("extension.ledgerAppNotFound", { app: "Arweave" }),
        },
        async ({ client, version, transport }) => {
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
        },
      );
    } catch (e) {
      if (e instanceof LedgerCancelled || signal.aborted) {
        setStep({ kind: "start" });
      } else {
        setStep({ kind: "error", message: ledgerErrorText(e) });
      }
    }
  };

  const cancel = () => abortRef.current?.abort();

  return (
    <ConnectShell title={t("extension.connectLedgerTitle")}>
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
            {t("extension.tryAgain")}
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
  const t = useT();
  return (
    <>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-body leading-relaxed text-muted">
        <li>{t("extension.ledgerStepPlug")}</li>
        <li>{t("extension.ledgerStepOpen")}</li>
        <li>{t("extension.ledgerStepConnect")}</li>
      </ol>
      <Button type="button" onClick={onConnect} disabled={busy}>
        {busy ? t("extension.connecting") : t("extension.connect")}
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
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-body leading-relaxed">
        {reason === "key"
          ? t("extension.ledgerGeneratingKey")
          : t("extension.ledgerWaitingForApp", { app: "Arweave" })}
      </p>
      <Button type="button" variant="secondary" onClick={onCancel}>
        {t("extension.cancel")}
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
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-body leading-relaxed">
        {t("extension.ledgerCheckAddress")}
      </p>
      <span className="break-all font-mono text-label text-foreground">
        {address}
      </span>
      <p className="text-caption text-muted">
        {t("extension.ledgerApproveOnDevice")}
      </p>
      <Button type="button" variant="secondary" onClick={onCancel}>
        {t("extension.cancel")}
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
  const t = useT();
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
        <span className="text-caption font-semibold text-muted">{t("extension.address")}</span>
        <span
          title={account.address}
          className="font-mono text-label text-foreground"
        >
          {truncateAddress(account.address)}
        </span>
      </div>
      <TextField
        label={t("extension.name")}
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
        {submitting ? t("extension.connecting") : t("extension.connect")}
      </Button>
    </div>
  );
}
