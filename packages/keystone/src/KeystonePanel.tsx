import { useEffect, useRef, useState, type ComponentType } from "react";
import type { UREncoder } from "@ngraveio/bc-ur";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { AnimatedQr } from "./AnimatedQr";
import { CAMERA_UNAVAILABLE_MESSAGE, CameraDeniedNotice } from "./CameraDeniedNotice";
import { QrScanner, type QrScannerProps, type ScannerError } from "./QrScanner";
import {
  buildKeystoneSignRequest,
  decodeKeystoneSignature,
  keystoneQrEncoder,
  KEYSTONE_SIGNATURE_UR_TYPE,
  KeystoneSignatureError,
} from "./sign-request";
import type { DeviceSignPanel, DeviceSignPanelProps } from "@gleam/app/src/approval/device-panels.tsx";

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

const SCAN_ERROR: Record<Exclude<ScanFailure, "camera-denied">, string> = {
  "camera-unavailable": CAMERA_UNAVAILABLE_MESSAGE,
  "wrong-type": "That's not a Keystone signature QR. On the Keystone, confirm the request, then scan the QR it shows.",
  "wrong-request":
    "That signature is for a different request. Show the QR again, scan it with your Keystone, then scan the new signature.",
  invalid: "Gleam couldn't read that QR. Hold the Keystone steady and try again.",
};

/** Keeps the background's request open while the user works the device without a message per QR frame. */
const ACTIVITY_THROTTLE_MS = 10_000;

/**
 * Builds every request up front, so a batch that can't be shown fails
 * before the user signs any of it.
 */
function prepare({ payloads, wallet }: Pick<DeviceSignPanelProps, "payloads" | "wallet">): Prepared {
  if (wallet.device?.kind !== "keystone") {
    return { ok: false, message: "This Keystone wallet has no master fingerprint. Remove it and connect it again." };
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
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export interface KeystonePanelOptions {
  /** Where this shell lets the user turn the camera back on. */
  cameraDeniedHelp: string;
  /** Swapped in tests, which have no camera. */
  Scanner?: ComponentType<QrScannerProps>;
}

export function createKeystonePanel({ cameraDeniedHelp, Scanner = QrScanner }: KeystonePanelOptions): DeviceSignPanel {
  return function KeystonePanel({ payloads, wallet, onSignatures, onActivity, onError }: DeviceSignPanelProps) {
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
            Item {index + 1} of {total}
          </p>
        ) : null}

        {step.kind === "show" ? (
          <>
            <p className="text-center text-label leading-snug text-muted">Scan this with your Keystone</p>
            <AnimatedQr
              key={index}
              encoder={request.encoder}
              onFrame={activity}
              label={total > 1 ? `Signing request ${index + 1} for Keystone` : "Signing request for Keystone"}
            />
            <Button type="button" onClick={scanAgain}>
              Scan Keystone&apos;s signature
            </Button>
          </>
        ) : null}

        {step.kind === "scan" ? (
          <>
            <p className="text-center text-label leading-snug text-muted">
              Confirm on your Keystone, then scan the signature it shows.
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
            <div
              role="progressbar"
              aria-label="Scan progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={step.percent}
              className="h-1 w-full overflow-hidden rounded-full bg-mist"
            >
              <div className="h-full bg-foreground transition-[width]" style={{ width: `${step.percent}%` }} />
            </div>
            <Button type="button" variant="secondary" onClick={() => setStep({ kind: "show" })}>
              Show the QR again
            </Button>
          </>
        ) : null}

        {step.kind === "scan-error" ? (
          <>
            {step.error === "camera-denied" ? (
              <CameraDeniedNotice help={cameraDeniedHelp} />
            ) : (
              <p role="alert" className="text-caption leading-snug text-warning">
                {SCAN_ERROR[step.error]}
              </p>
            )}
            <Button type="button" onClick={scanAgain}>
              Scan again
            </Button>
            <Button type="button" variant="secondary" onClick={() => setStep({ kind: "show" })}>
              Show the QR again
            </Button>
          </>
        ) : null}
      </div>
    );
  };
}
