import { useState, type ComponentType } from "react";
import { addressFromOwner, type RuntimePort, type WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { CameraDeniedNotice, type CameraDeniedHelp } from "./CameraDeniedNotice";
import { decodeKeystoneAccount, KEYSTONE_ACCOUNT_UR_TYPE, type KeystoneAccount } from "./decode-account";
import { QrScanner, type QrScannerProps, type ScannerError } from "./QrScanner";
import { ScanProgress } from "./ScanProgress";
import { errorText as defaultErrorText } from "@gleam/app/src/i18n/errors.ts";
import { useT, type MessageKey } from "@gleam/app/src/i18n/index.tsx";

export interface KeystoneConnectViewProps {
  runtime: RuntimePort;
  /** The account was added as a wallet. */
  onConnected: (wallet: WalletSummary) => void;
  /** Where this shell lets the user turn the camera back on. */
  cameraDeniedHelp: CameraDeniedHelp;
  /** Rewrites the background's refusal of `addHardwareWallet` for this shell. Defaults to its translated message. */
  errorText?: (error: unknown) => string;
  /** Swapped in tests, which have no camera. */
  Scanner?: ComponentType<QrScannerProps>;
}

type Step =
  | { kind: "scan"; attempt: number; percent: number }
  | { kind: "scan-error"; error: ScannerError }
  | { kind: "confirm"; account: KeystoneAccount; address: string };

const SCAN_ERROR: Record<Exclude<ScannerError, "camera-denied">, MessageKey> = {
  "camera-unavailable": "extension.cameraUnavailable",
  "wrong-type": "extension.scanWrongAccount",
  invalid: "extension.scanInvalid",
};

/** Scans a Keystone's account QR and adds that account as a wallet. Each shell draws the page around it. */
export function KeystoneConnectView({
  runtime,
  onConnected,
  cameraDeniedHelp,
  errorText = defaultErrorText,
  Scanner = QrScanner,
}: KeystoneConnectViewProps) {
  const [step, setStep] = useState<Step>({ kind: "scan", attempt: 0, percent: 0 });

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
    <>
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
          cameraDeniedHelp={cameraDeniedHelp}
          onRetry={() => setStep({ kind: "scan", attempt: Date.now(), percent: 0 })}
        />
      ) : null}
      {step.kind === "confirm" ? (
        <ConfirmStep
          runtime={runtime}
          account={step.account}
          address={step.address}
          errorText={errorText}
          onConnected={onConnected}
          onRescan={() => setStep({ kind: "scan", attempt: Date.now(), percent: 0 })}
        />
      ) : null}
    </>
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
  const t = useT();
  return (
    <>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-body leading-relaxed text-muted">
        <li>{t("extension.keystoneStepConnect")}</li>
        <li>{t("extension.keystoneStepApp")}</li>
        <li>{t("extension.keystoneStepScan")}</li>
      </ol>
      <Scanner
        key={attempt}
        expectedType={KEYSTONE_ACCOUNT_UR_TYPE}
        onProgress={onProgress}
        onComplete={onComplete}
        onError={onError}
      />
      <div className="flex flex-col gap-1.5">
        <ScanProgress percent={percent} />
        <p className="text-caption text-muted">
          {percent > 0 ? t("extension.scanning", { percent }) : t("extension.waitingForQr")}
        </p>
      </div>
    </>
  );
}

function ScanErrorStep({
  error,
  cameraDeniedHelp,
  onRetry,
}: {
  error: ScannerError;
  cameraDeniedHelp: CameraDeniedHelp;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      {error === "camera-denied" ? (
        <CameraDeniedNotice help={cameraDeniedHelp} />
      ) : (
        <p role="alert" className="text-body leading-relaxed text-warning">
          {t(SCAN_ERROR[error])}
        </p>
      )}
      <Button type="button" onClick={onRetry}>
        {t("extension.tryAgain")}
      </Button>
    </div>
  );
}

function ConfirmStep({
  runtime,
  account,
  address,
  errorText,
  onConnected,
  onRescan,
}: {
  runtime: RuntimePort;
  account: KeystoneAccount;
  address: string;
  errorText: (error: unknown) => string;
  onConnected: (wallet: WalletSummary) => void;
  onRescan: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const wallet = await runtime.send<
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
      onConnected(wallet);
    } catch (e) {
      setError(errorText(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-body leading-relaxed">{t("extension.keystoneCheckAddress")}</p>
        <span className="break-all font-mono text-label text-foreground">{address}</span>
      </div>
      <TextField
        label={t("extension.name")}
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
          {submitting ? t("extension.connecting") : t("extension.connect")}
        </Button>
        <Button type="button" variant="secondary" onClick={onRescan} disabled={submitting}>
          {t("extension.scanAgain")}
        </Button>
      </div>
    </div>
  );
}
