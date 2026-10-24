import { useEffect, useRef, useState } from "react";
import { WALLET_APPROVAL_ORIGIN, type DeviceSigningRequest, type DeviceSigningSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { formatAtomicAsDisplay, formatWinstonAsAr } from "../screens/main-screen/src/formatWinston";
import { DEVICE_NAMES, type DeviceSignPanel } from "./device-panels";

/**
 * Shown once the user has approved a hardware wallet's request: the
 * background has built the unsigned payloads and waits for the device's
 * signatures. Above the panel it shows what the payloads actually say
 * (the background decodes them), since the fee is only fixed once the
 * transaction is built after approval. The method's `DeviceSignPanel`
 * drives the device; this view
 * submits what it returns, shows a refused signature or device error with
 * a retry that remounts the panel, owns Cancel, and reports activity
 * every `DEVICE_HEARTBEAT_MS` while mounted so the background keeps the
 * request open past its review timeout.
 */
export interface AwaitingDeviceViewProps {
  origin: string;
  device: DeviceSigningRequest;
  Panel: DeviceSignPanel;
  /** Rejects with the background's reason (such as a signature that didn't verify). */
  onSubmit: (signatures: string[]) => Promise<void>;
  onCancel: () => void;
  onActivity: () => Promise<unknown>;
  /** The preview's resolved token scale, used for an AO transfer of that token. */
  token?: { processId: string; denomination: number | null; ticker: string | null };
}

/** Well inside the background's idle window, so one missed beat doesn't time the request out. */
export const DEVICE_HEARTBEAT_MS = 60_000;

function hostnameOf(origin: string): string {
  if (origin === WALLET_APPROVAL_ORIGIN) return "Gleam";
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function AwaitingDeviceView({ origin, device, Panel, onSubmit, onCancel, onActivity, token }: AwaitingDeviceViewProps) {
  const [attempt, setAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const activity = useRef(onActivity);
  activity.current = onActivity;
  const name = DEVICE_NAMES[device.method];
  const host = hostnameOf(origin);

  const reportActivity = () => void activity.current().catch(() => {});

  useEffect(() => {
    const timer = setInterval(() => void activity.current().catch(() => {}), DEVICE_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, []);

  const handleSignatures = async (signatures: string[]) => {
    setSubmitting(true);
    try {
      await onSubmit(signatures);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setSubmitting(false);
    }
  };

  const retry = () => {
    setError(undefined);
    setAttempt((current) => current + 1);
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
        <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-md border border-line bg-mist text-[10px] font-bold text-muted">
          {host.charAt(0).toUpperCase()}
        </div>
        <span className="min-w-0 flex-1 truncate text-caption font-semibold text-foreground">{host}</span>
      </div>

      <div className="flex flex-1 flex-col gap-5 px-5 py-4.5">
        <div className="text-center text-body font-bold text-foreground">Confirm on your {name}</div>

        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold uppercase tracking-wide text-muted">Signing as</span>
          <span className="break-all font-mono text-caption leading-relaxed text-foreground">{device.address}</span>
        </div>

        <div className="flex flex-col gap-3">
          {device.summaries.map((summary, index) => (
            <div key={index} className="flex flex-col">
              {device.summaries.length > 1 ? (
                <span className="pb-1 text-caption font-semibold text-foreground">Item {index + 1}</span>
              ) : null}
              <SummaryRows summary={summary} token={token} />
            </div>
          ))}
        </div>

        {error ? (
          <div role="alert" className="text-caption leading-snug text-warning">
            {error}
          </div>
        ) : submitting ? (
          <p role="status" className="text-center text-caption text-muted">
            Checking the signature…
          </p>
        ) : (
          <Panel
            key={attempt}
            payloads={device.payloads}
            wallet={{ method: device.method, device: device.device, address: device.address, publicKey: device.publicKey }}
            onSignatures={(signatures) => void handleSignatures(signatures)}
            onActivity={reportActivity}
            onError={setError}
            onCancel={onCancel}
          />
        )}

        <div className="mt-auto flex gap-2.5 pt-1">
          <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
          {error ? (
            <Button type="button" variant="primary" onClick={retry} className="flex-1">
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryRows({ summary, token }: { summary: DeviceSigningSummary; token: AwaitingDeviceViewProps["token"] }) {
  if (summary.kind === "transaction") {
    return (
      <>
        {summary.recipient !== null ? <Row label="Recipient" value={summary.recipient} mono /> : null}
        {summary.recipient !== null ? <Row label="Amount" value={`${formatWinstonAsAr(summary.quantity)} AR`} /> : null}
        <Row label="Fee" value={`${formatWinstonAsAr(summary.fee)} AR`} />
        {summary.dataSize !== "0" ? <Row label="Data" value={`${summary.dataSize} bytes`} /> : null}
      </>
    );
  }
  if (summary.kind === "aoTransfer" || summary.kind === "l1TokenTransfer") {
    // Scaled only for the token the preview resolved; any other target is
    // shown as unknown rather than trusted to be a token at all.
    const scale = token?.processId === summary.process ? token : undefined;
    const quantity =
      scale?.denomination != null
        ? `${formatAtomicAsDisplay(summary.quantity, scale.denomination)} ${scale.ticker ?? ""}`.trim()
        : `${summary.quantity} smallest units`;
    return (
      <>
        <Row label="Token" value={scale?.ticker ?? "Unknown token"} />
        <Row label="Token process" value={summary.process} mono />
        <Row label="Recipient" value={summary.recipient} mono />
        <Row label="Amount" value={quantity} />
        {summary.kind === "l1TokenTransfer" ? <Row label="Fee" value={`${formatWinstonAsAr(summary.fee, 12)} AR`} /> : null}
      </>
    );
  }
  if (summary.kind === "collectibleTransfer") {
    return (
      <>
        <Row label="Collectible" value={summary.asset} mono />
        <Row label="Recipient" value={summary.recipient} mono />
        <Row label="Fee" value={`${formatWinstonAsAr(summary.fee, 12)} AR`} />
      </>
    );
  }
  if (summary.kind === "message") {
    return summary.text !== null ? (
      <Row label="Message" value={summary.text} />
    ) : (
      <Row label="Message" value={`${summary.size} bytes`} />
    );
  }
  return (
    <>
      {summary.target !== null ? <Row label="Target" value={summary.target} mono /> : null}
      <Row label="Data" value={`${summary.dataSize} bytes`} />
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 text-caption last:border-b-0">
      <span className="flex-shrink-0 text-muted">{label}</span>
      <span className={`min-w-0 break-all text-right font-semibold text-foreground ${mono ? "font-mono" : "tabular-nums"}`}>
        {value}
      </span>
    </div>
  );
}
