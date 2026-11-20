import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CollectibleRef, DeviceSigningRequest, DeviceSigningSummary, NameTargetPreview } from "@gleam/core";
import { MemorableAddress } from "@gleam/ui/src/components/wallet/index.ts";
import { useAddressIdentity } from "../address-identity";
import { useT, type TFunction } from "../i18n";
import { formatAtomicAsDisplay, formatWinstonAsAr } from "../screens/main-screen/src/formatWinston";
import { DEVICE_NAMES, type DeviceSignPanel } from "./device-panels";
import { errorText } from "../i18n/errors";
import { RequestHeader } from "../transfer-review/RequestHeader";
import { UntrustedText } from "./UntrustedText";
import { DeviceBanner, NameTargetReview, ReviewButtons, TransferReview } from "../transfer-review/TransferReview";
import { requestTypeText, transferRequestFromDevice, type TransferContext } from "../transfer-review/model";

/**
 * Shown once the user has approved a hardware wallet's request: the
 * background has built the unsigned payloads and waits for the device's
 * signatures. Above the panel it shows what the payloads actually say
 * (the background decodes them), since the fee is only fixed once the
 * transaction is built after approval. Payloads that only move value
 * show in `TransferReview`'s layout under a "Confirm on your device"
 * strip; anything else lists the decoded rows. The method's `DeviceSignPanel`
 * drives the device; this view
 * submits what it returns, shows a refused signature or device error with
 * a retry that remounts the panel, owns Cancel, and reports activity
 * every `DEVICE_HEARTBEAT_MS` while mounted so the background keeps the
 * request open past its review timeout.
 */
export interface AwaitingDeviceViewProps {
  origin: string;
  /** The site's icon from its grant, if any. */
  siteIcon?: string | null;
  device: DeviceSigningRequest;
  Panel: DeviceSignPanel;
  /** Rejects with the background's reason (such as a signature that didn't verify). */
  onSubmit: (signatures: string[]) => Promise<void>;
  onCancel: () => void;
  onActivity: () => Promise<unknown>;
  /** The preview's resolved token scale, used for an AO transfer of that token. */
  token?: { processId: string; denomination: number | null; ticker: string | null; impersonating?: true };
  /** The preview's collectible, named and pictured when the payload sends that asset. */
  collectible?: CollectibleRef | null;
  /** The preview's name change; its label names the carrier when the payload is that name's set. */
  nameTarget?: NameTargetPreview | null;
  /** The signing wallet; defaults to the device's address alone. */
  from?: { name: string | null; address: string };
  context?: TransferContext;
}

/** Well inside the background's idle window, so one missed beat doesn't time the request out. */
export const DEVICE_HEARTBEAT_MS = 60_000;

function requestTypeOf(summaries: DeviceSigningSummary[], t: TFunction): string {
  if (summaries.some((summary) => summary.kind === "transaction" || summary.kind === "nameTarget")) return t("approval.actionSignAndSend");
  if (summaries.length > 1) return t("approval.actionSignMessagesCount", { count: summaries.length });
  return t("approval.actionSignMessage");
}

export function AwaitingDeviceView({
  origin,
  siteIcon,
  device,
  Panel,
  onSubmit,
  onCancel,
  onActivity,
  token,
  collectible,
  nameTarget,
  from,
  context = {},
}: AwaitingDeviceViewProps) {
  const t = useT();
  const [attempt, setAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ReactNode>();
  const activity = useRef(onActivity);
  activity.current = onActivity;
  const name = DEVICE_NAMES[device.method];
  const transfer = transferRequestFromDevice(device.summaries, token, collectible);

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
      setError(errorText(submitError));
      setSubmitting(false);
    }
  };

  const retry = () => {
    setError(undefined);
    setAttempt((current) => current + 1);
  };

  const panelArea = error ? (
    <div role="alert" className="text-caption leading-snug text-warning">
      {error}
    </div>
  ) : submitting ? (
    <p role="status" className="text-center text-caption text-muted">
      {t("approval.checkingSignature")}
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
  );

  const buttons = (
    <ReviewButtons
      secondaryLabel={t("approval.cancel")}
      onSecondary={onCancel}
      primaryLabel={error ? t("approval.tryAgain") : undefined}
      onPrimary={error ? retry : undefined}
      warned={false}
    />
  );

  // Read from the payload; the preview only lends the label, and only for the carrier the payload names.
  const [only] = device.summaries;
  if (device.summaries.length === 1 && only?.kind === "nameTarget" && nameTarget?.carrier === only.carrier) {
    return (
      <NameTargetReview
        header={<RequestHeader origin={origin} icon={siteIcon} requestType={t("collectibles.changeTarget")} />}
        banner={<DeviceBanner text={t("approval.confirmOnDevice", { device: name })} />}
        label={nameTarget.label}
        target={only.target}
        fee={only.fee}
        from={from ?? { name: null, address: device.address }}
        context={context}
        footer={buttons}
      >
        {panelArea}
      </NameTargetReview>
    );
  }

  if (transfer) {
    return (
      <TransferReview
        header={<RequestHeader origin={origin} icon={siteIcon} requestType={requestTypeText(origin, transfer, t)} />}
        banner={<DeviceBanner text={t("approval.confirmOnDevice", { device: name })} />}
        request={transfer}
        from={from ?? { name: null, address: device.address }}
        context={context}
        risk={null}
        footer={() => buttons}
      >
        {panelArea}
      </TransferReview>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <RequestHeader origin={origin} icon={siteIcon} requestType={requestTypeOf(device.summaries, t)} />

      <div className="flex flex-col gap-5 px-6 pt-5 phone:px-5">
        <DeviceBanner text={t("approval.confirmOnDevice", { device: name })} />

        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-semibold uppercase tracking-wide text-muted">{t("approval.signingAs")}</span>
          <AddressValue address={device.address} />
        </div>

        {/* On paper, the rows to compare against the device sit under one pane of glass; the signer stays on the paper. */}
        <div className="gleam-paper-glass-down flex flex-col gap-3 paper:-mx-6 paper:px-6 paper:pb-5 paper:pt-3 phone:paper:-mx-5 phone:paper:px-5">
          {device.summaries.map((summary, index) => (
            <div key={index} className="flex flex-col">
              {device.summaries.length > 1 ? (
                <span className="pb-1 text-caption font-semibold text-foreground">{t("approval.itemNumber", { number: index + 1 })}</span>
              ) : null}
              <SummaryRows summary={summary} token={token} />
            </div>
          ))}
        </div>

        {panelArea}
      </div>

      {buttons}
    </div>
  );
}

function SummaryRows({ summary, token }: { summary: DeviceSigningSummary; token: AwaitingDeviceViewProps["token"] }) {
  const t = useT();
  if (summary.kind === "transaction") {
    return (
      <>
        {summary.unreadableTokenTransfer ? (
          <p role="alert" className="pb-1 text-caption leading-snug text-warning">
            {t("transferReview.unreadableTokenTransfer")}
          </p>
        ) : null}
        {summary.recipient !== null ? <Row label={t("approval.amount")} value={`${formatWinstonAsAr(summary.quantity, 12)} AR`} /> : null}
        {summary.recipient !== null ? <AddressRow label={t("approval.recipient")} address={summary.recipient} /> : null}
        <Row label={t("approval.fee")} value={`${formatWinstonAsAr(summary.fee, 12)} AR`} />
        {summary.dataSize !== "0" ? <Row label={t("approval.data")} value={t("approval.bytes", { size: summary.dataSize })} /> : null}
      </>
    );
  }
  if (summary.kind === "aoTransfer" || summary.kind === "l1TokenTransfer") {
    // Scaled only for the token the preview resolved; any other target is
    // shown as unknown rather than trusted to be a token at all.
    const scale = token?.processId === summary.process ? token : undefined;
    const quantity =
      scale?.denomination != null ? (
        <>
          {formatAtomicAsDisplay(summary.quantity, scale.denomination, scale.denomination)}
          {scale.ticker?.trim() ? <> <UntrustedText text={scale.ticker} /></> : null}
        </>
      ) : (
        t("approval.amountSmallestUnits", { quantity: summary.quantity })
      );
    return (
      <>
        {/* A resolved ticker already names the token in the amount. */}
        {scale === undefined ? <Row label={t("approval.token")} value={t("approval.unknownToken")} /> : null}
        <Row label={t("approval.amount")} value={quantity} />
        <AddressRow label={t("approval.recipient")} address={summary.recipient} />
        <AddressRow label={t("approval.tokenProcess")} address={summary.process} />
        {summary.kind === "l1TokenTransfer" ? <Row label={t("approval.fee")} value={`${formatWinstonAsAr(summary.fee, 12)} AR`} /> : null}
      </>
    );
  }
  if (summary.kind === "collectibleTransfer") {
    return (
      <>
        <AddressRow label={t("approval.collectible")} address={summary.asset} />
        <AddressRow label={t("approval.recipient")} address={summary.recipient} />
        <Row label={t("approval.fee")} value={`${formatWinstonAsAr(summary.fee, 12)} AR`} />
      </>
    );
  }
  if (summary.kind === "nameTarget") {
    return (
      <>
        <AddressRow label={t("collectibles.name")} address={summary.carrier} />
        <AddressRow label={t("collectibles.pointsTo")} address={summary.target} />
        <Row label={t("approval.fee")} value={`${formatWinstonAsAr(summary.fee, 12)} AR`} />
      </>
    );
  }
  if (summary.kind === "message") {
    return summary.text !== null ? (
      <Row label={t("approval.message")} value={<UntrustedText text={summary.text} />} />
    ) : (
      <Row label={t("approval.message")} value={t("approval.bytes", { size: summary.size })} />
    );
  }
  return (
    <>
      {summary.unreadableTokenTransfer ? (
        <p role="alert" className="pb-1 text-caption leading-snug text-warning">
          {t("transferReview.unreadableTokenTransfer")}
        </p>
      ) : null}
      {summary.target !== null ? <AddressRow label={t("approval.target")} address={summary.target} /> : null}
      <Row label={t("approval.data")} value={t("approval.bytes", { size: summary.dataSize })} />
    </>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 text-caption last:border-b-0">
      <span className="flex-shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-right font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/**
 * An address or id on its own line in `MemorableAddress`'s chunked form,
 * so it never wraps mid-chunk. Every one, process ids included, gets its
 * derived avatar: unlike a token logo it can't be claimed by a lookalike.
 */
function AddressRow({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line py-2 text-caption last:border-b-0">
      <span className="text-muted">{label}</span>
      <AddressValue address={address} />
    </div>
  );
}

function AddressValue({ address }: { address: string }) {
  const identity = useAddressIdentity();
  return <MemorableAddress address={address} emphasisPick={identity.emphasisPick} avatarSvg={identity.avatarSvg(address)} />;
}
