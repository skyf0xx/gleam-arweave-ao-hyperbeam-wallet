import { useEffect, useState, type ComponentType } from "react";
import { addressFromOwner, type RuntimePort, type WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import {
  CAMERA_UNAVAILABLE_MESSAGE,
  CameraDeniedNotice,
  decodeKeystoneAccount,
  KEYSTONE_ACCOUNT_UR_TYPE,
  QrScanner,
  type KeystoneAccount,
  type QrScannerProps,
  type ScannerError,
} from "@/src/hardware/keystone";
import { backgroundErrorText, ConnectedNotice, ConnectShell, truncateAddress } from "./connect-shared";

export interface ConnectViewProps {
  runtime: RuntimePort;
  /** Swapped in tests, which have no camera. */
  Scanner?: ComponentType<QrScannerProps>;
  onClose?: () => void;
  autoCloseMs?: number;
}

type Step =
  | { kind: "scan"; attempt: number; percent: number }
  | { kind: "scan-error"; error: ScannerError }
  | { kind: "confirm"; account: KeystoneAccount; address: string }
  | { kind: "done" };

const SCAN_ERROR: Record<Exclude<ScannerError, "camera-denied">, string> = {
  "camera-unavailable": CAMERA_UNAVAILABLE_MESSAGE,
  "wrong-type": "That's not a Keystone Arweave account QR. On the Keystone, open the Arweave wallet and show its connection QR.",
  invalid: "Gleam couldn't read that QR. Hold the Keystone steady and try again.",
};

export function ConnectView({
  runtime,
  Scanner = QrScanner,
  onClose = () => window.close(),
  autoCloseMs = 3000,
}: ConnectViewProps) {
  const [step, setStep] = useState<Step>({ kind: "scan", attempt: 0, percent: 0 });

  useEffect(() => {
    if (step.kind !== "done") return;
    const timer = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(timer);
  }, [step.kind, onClose, autoCloseMs]);

  const handleComplete: QrScannerProps["onComplete"] = async (ur) => {
    try {
      const account = decodeKeystoneAccount(ur);
      const address = await addressFromOwner(account.publicKey);
      setStep({ kind: "confirm", account, address });
    } catch {
      setStep({ kind: "scan-error", error: "wrong-type" });
    }
  };

  return (
    <ConnectShell title="Connect Keystone">
    {step.kind === "scan" ? (
      <ScanStep
        percent={step.percent}
        Scanner={Scanner}
        attempt={step.attempt}
        onProgress={(percent) => setStep((s) => (s.kind === "scan" ? { ...s, percent } : s))}
        onComplete={(ur) => void handleComplete(ur)}
        onError={(error) => setStep({ kind: "scan-error", error })}
      />
    ) : null}
    {step.kind === "scan-error" ? (
      <ScanErrorStep
        error={step.error}
        onRetry={() => setStep({ kind: "scan", attempt: Date.now(), percent: 0 })}
      />
    ) : null}
    {step.kind === "confirm" ? (
      <ConfirmStep
        runtime={runtime}
        account={step.account}
        address={step.address}
        onConnected={() => setStep({ kind: "done" })}
        onRescan={() => setStep({ kind: "scan", attempt: Date.now(), percent: 0 })}
      />
    ) : null}
    {step.kind === "done" ? <ConnectedNotice device="Keystone" onClose={onClose} /> : null}
    </ConnectShell>
  );
}

function ScanStep({
  percent,
  attempt,
  Scanner,
  onProgress,
  onComplete,
  onError,
}: {
  percent: number;
  attempt: number;
  Scanner: ComponentType<QrScannerProps>;
  onProgress: (percent: number) => void;
  onComplete: QrScannerProps["onComplete"];
  onError: QrScannerProps["onError"];
}) {
  return (
    <>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-body leading-relaxed text-muted">
        <li>On the Keystone, open the Arweave wallet, or choose Connect Software Wallet.</li>
        <li>Choose Wander or Beacon.</li>
        <li>Hold the QR it shows up to the camera.</li>
      </ol>
      <Scanner
        key={attempt}
        expectedType={KEYSTONE_ACCOUNT_UR_TYPE}
        onProgress={onProgress}
        onComplete={onComplete}
        onError={onError}
      />
      <div className="flex flex-col gap-1.5">
        <div
          role="progressbar"
          aria-label="Scan progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1 w-full overflow-hidden rounded-full bg-mist"
        >
          <div className="h-full bg-foreground transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-caption text-muted">
          {percent > 0 ? `Scanning… ${percent}%. Keep the QR in view until it finishes.` : "Waiting for the QR…"}
        </p>
      </div>
    </>
  );
}

function ScanErrorStep({ error, onRetry }: { error: ScannerError; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {error === "camera-denied" ? (
        <CameraDeniedNotice />
      ) : (
        <p role="alert" className="text-body leading-relaxed text-warning">
          {SCAN_ERROR[error]}
        </p>
      )}
      <Button type="button" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function ConfirmStep({
  runtime,
  account,
  address,
  onConnected,
  onRescan,
}: {
  runtime: RuntimePort;
  account: KeystoneAccount;
  address: string;
  onConnected: () => void;
  onRescan: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await runtime.send<
        { method: "keystone"; publicKey: string; device: { kind: "keystone"; xfp: string }; name?: string },
        WalletSummary
      >({
        type: "addHardwareWallet",
        payload: {
          method: "keystone",
          publicKey: account.publicKey,
          device: { kind: "keystone", xfp: account.xfp },
          ...(name.trim() ? { name: name.trim() } : {}),
        },
      });
      onConnected();
    } catch (e) {
      setError(backgroundErrorText(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-caption font-semibold text-muted">Address</span>
        <span title={address} className="font-mono text-label text-foreground">
          {truncateAddress(address)}
        </span>
      </div>
      <TextField
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Keystone"
        maxLength={40}
        autoComplete="off"
      />
      {error ? (
        <p role="alert" className="text-caption leading-snug text-warning">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col gap-2.5">
        <Button type="button" onClick={() => void connect()} disabled={submitting}>
          {submitting ? "Connecting…" : "Connect"}
        </Button>
        <Button type="button" variant="secondary" onClick={onRescan} disabled={submitting}>
          Scan again
        </Button>
      </div>
    </div>
  );
}
