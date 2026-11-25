import { useEffect, useRef, useState, type ComponentType } from "react";
import type { UREncoder } from "@ngraveio/bc-ur";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { AnimatedQr } from "./AnimatedQr";
import { CameraDeniedNotice, type CameraDeniedHelp } from "./CameraDeniedNotice";
import { QrScanner, type QrScannerProps, type ScannerError } from "./QrScanner";
import { ScanProgress } from "./ScanProgress";
import {
  buildKeystoneSignRequest,
  decodeKeystoneSignature,
  keystoneQrEncoder,
  KEYSTONE_SIGNATURE_UR_TYPE,
  KeystoneSignatureError,
} from "./sign-request";
import type { DeviceSignPanel, DeviceSignPanelProps } from "@gleam/app/src/approval/device-panels.tsx";
import { errorText } from "@gleam/app/src/i18n/errors.ts";
import { t, useT, type MessageKey } from "@gleam/app/src/i18n/index.tsx";

interface PreparedRequest {
  requestId: string;
  encoder: UREncoder;
}

type Prepared = { ok: true; requests: PreparedRequest[] } | { ok: false; message: string };

type ScanFailure = ScannerError | "wrong-request";

type Step =
  | { kind: "show" }
  | { kind: "scan"; attempt: number; percent: number }
  | { kind: "scan-error"; error: ScanFailure };

const SCAN_ERROR: Record<Exclude<ScanFailure, "camera-denied">, MessageKey> = {
  "camera-unavailable": "extension.cameraUnavailable",
  "wrong-type": "extension.scanWrongSignature",
  "wrong-request": "extension.scanWrongRequest",
  invalid: "extension.scanInvalid",
};

/** Keeps the background's request open while the user works the device without a message per QR frame. */
const ACTIVITY_THROTTLE_MS = 10_000;

/**
 * Builds every request up front, so a batch that can't be shown fails
 * before the user signs any of it.
 */
function prepare({ payloads, wallet }: Pick<DeviceSignPanelProps, "payloads" | "wallet">): Prepared {
  if (wallet.device?.kind !== "keystone") {
    return { ok: false, message: t("extension.keystoneNoFingerprint") };
  }
  const { xfp } = wallet.device;
  try {
    return {
      ok: true,
      requests: payloads.map((payload) => {
        const { requestId, ur } = buildKeystoneSignRequest(payload, xfp);
        return { requestId, encoder: keystoneQrEncoder(ur) };
      }),
    };
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
}

export interface KeystonePanelOptions {
  /** Where this shell lets the user turn the camera back on. */
  cameraDeniedHelp: CameraDeniedHelp;
  /** Swapped in tests, which have no camera. */
  Scanner?: ComponentType<QrScannerProps>;
}

export function createKeystonePanel({ cameraDeniedHelp, Scanner = QrScanner }: KeystonePanelOptions): DeviceSignPanel {
  return function KeystonePanel({ payloads, wallet, onSignatures, onActivity, onError }: DeviceSignPanelProps) {
    const t = useT();
    const [prepared] = useState(() => prepare({ payloads, wallet }));
    const [index, setIndex] = useState(0);
    const [step, setStep] = useState<Step>({ kind: "show" });
    const signatures = useRef<string[]>([]);
    const lastActivity = useRef(0);

    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    const failure = prepared.ok ? null : prepared.message;
    useEffect(() => {
      if (failure) onErrorRef.current(failure);
    }, [failure]);

    if (!prepared.ok) return <></>;

    const request = prepared.requests[index]!;
    const total = prepared.requests.length;

    const activity = () => {
      const now = Date.now();
      if (now - lastActivity.current < ACTIVITY_THROTTLE_MS) return;
      lastActivity.current = now;
      onActivity();
    };

    const scanAgain = () => setStep({ kind: "scan", attempt: Date.now(), percent: 0 });

    const handleComplete: QrScannerProps["onComplete"] = (ur) => {
      let signature: string;
      try {
        signature = decodeKeystoneSignature(ur, request.requestId);
      } catch (error) {
        const reason = error instanceof KeystoneSignatureError ? error.reason : "invalid";
        setStep({ kind: "scan-error", error: reason });
        return;
      }
      activity();
      signatures.current = [...signatures.current.slice(0, index), signature];
      if (index + 1 < total) {
        setIndex(index + 1);
        setStep({ kind: "show" });
      } else {
        onSignatures(signatures.current);
      }
    };

    return (
      <div className="flex flex-col gap-4">
        {total > 1 ? (
          <p className="text-center text-caption font-semibold text-foreground">
            {t("extension.itemOfTotal", { index: index + 1, total })}
          </p>
        ) : null}

        {step.kind === "show" ? (
          <>
            <p className="text-center text-label leading-snug text-muted">{t("extension.scanWithKeystone")}</p>
            <AnimatedQr
              key={index}
              encoder={request.encoder}
              onFrame={activity}
              label={total > 1 ? t("extension.signingRequestOf", { index: index + 1 }) : t("extension.signingRequest")}
            />
            <Button type="button" onClick={scanAgain}>
              {t("extension.scanKeystoneSignature")}
            </Button>
          </>
        ) : null}

        {step.kind === "scan" ? (
          <>
            <p className="text-center text-label leading-snug text-muted">
              {t("extension.confirmOnKeystone")}
            </p>
            <Scanner
              key={step.attempt}
              expectedType={KEYSTONE_SIGNATURE_UR_TYPE}
              onProgress={(percent) => {
                activity();
                setStep((s) => (s.kind === "scan" ? { ...s, percent } : s));
              }}
              onComplete={handleComplete}
              onError={(error) => setStep({ kind: "scan-error", error })}
            />
            <ScanProgress percent={step.percent} />
            <Button type="button" variant="secondary" onClick={() => setStep({ kind: "show" })}>
              {t("extension.showQrAgain")}
            </Button>
          </>
        ) : null}

        {step.kind === "scan-error" ? (
          <>
            {step.error === "camera-denied" ? (
              <CameraDeniedNotice help={cameraDeniedHelp} />
            ) : (
              <p role="alert" className="text-caption leading-snug text-warning">
                {t(SCAN_ERROR[step.error])}
              </p>
            )}
            <Button type="button" onClick={scanAgain}>
              {t("extension.scanAgain")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setStep({ kind: "show" })}>
              {t("extension.showQrAgain")}
            </Button>
          </>
        ) : null}
      </div>
    );
  };
}
