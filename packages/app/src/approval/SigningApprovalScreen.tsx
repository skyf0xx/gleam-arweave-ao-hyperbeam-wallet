import { useState } from "react";
import { WALLET_APPROVAL_ORIGIN, type RecipientAssessment, type SigningApprovalPreview } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { RiskNotice } from "@gleam/ui/src/primitives/risk-notice.tsx";
import { useT, type MessageKey, type TFunction } from "../i18n";
import { formatWinstonAsAr } from "../screens/main-screen/src/formatWinston";
import { errorText } from "../i18n/errors";
import { UntrustedText } from "./UntrustedText";
import { DataItemCard } from "../transfer-review/DataItemCard";
import { RequestHeader } from "../transfer-review/RequestHeader";
import { ReviewButtons, TransferReview } from "../transfer-review/TransferReview";
import { requestTypeText, transferRequestFromPreview, type TransferContext } from "../transfer-review/model";
import { CopyIcon } from "@gleam/ui/src/primitives/copy-icons.tsx";

/**
 * The highest-stakes screen in the product. A request that moves value
 * shows `TransferReview`, the one layout every send shares; any other
 * signing request shows its decoded data, tags and the SHA-256 hash of
 * the exact signing payload with its own copy affordance, under the same
 * header. Never uses the beam as anything but the small identity mark,
 * and never uses humor here: maximum clarity, zero cleverness.
 */
export interface SigningApprovalScreenProps {
  origin: string;
  /** The site's icon from its grant, if any. */
  siteIcon?: string | null;
  preview: SigningApprovalPreview;
  /** Recipient checks for a transfer; omitted or null means the lookup failed, and the warning still shows. */
  assessment?: RecipientAssessment | null;
  /** The signing wallet, shown as From. */
  from?: { name: string | null; address: string } | null;
  /** Balances, prices and display settings for the fiat line and the balance after. */
  context?: TransferContext;
  onReject: () => void;
  /** Rejects (surfacing its message inline) if signing fails — e.g. the wallet's unlocked session has since expired. */
  onSign: () => Promise<void>;
}

const REQUEST_KIND_COPY: Record<SigningApprovalPreview["kind"], MessageKey> = {
  sign: "approval.actionSignAndSend",
  dispatch: "approval.actionSignAndSend",
  signDataItem: "approval.actionSignMessage",
  batchSignDataItem: "approval.actionSignMessages",
  encrypt: "approval.actionEncryptData",
  decrypt: "approval.actionDecryptData",
  transferAoTokens: "approval.actionSend",
  signMessage: "approval.actionSignMessage",
  transfer: "approval.actionSend",
  pointsProof: "approval.actionProveOwnership",
};

function actionCopy(preview: SigningApprovalPreview, t: TFunction): string {
  if (preview.kind === "batchSignDataItem" && preview.items) {
    return t("approval.actionSignMessagesCount", { count: preview.items.length });
  }
  return t(REQUEST_KIND_COPY[preview.kind]);
}

function formatFee(fee: string): string {
  return `${formatWinstonAsAr(fee, 12)} AR`;
}

async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard access can be denied by the browser — the value is still
    // fully visible and selectable on screen, so this is a soft failure.
  }
}

export function SigningApprovalScreen({
  origin,
  siteIcon,
  preview,
  assessment,
  from = null,
  context = {},
  onReject,
  onSign,
}: SigningApprovalScreenProps) {
  const t = useT();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const transfer = transferRequestFromPreview(preview);
  // A data item that looks like a token transfer the wallet can't read
  // shows as the plain item, its tags in full, under a warning.
  const unreadable = preview.items?.some((item) => item.unreadableTokenTransfer === true) ?? false;

  const handleSign = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await onSign();
    } catch (submitError) {
      setError(errorText(submitError));
      setSubmitting(false);
    }
  };

  const errorLine = error ? (
    <div role="alert" className="text-caption leading-snug text-warning">
      {error}
    </div>
  ) : null;

  if (transfer) {
    const own = origin === WALLET_APPROVAL_ORIGIN;
    const signLabel = transfer.itemCount > 1 ? t("transferReview.signCount", { count: transfer.itemCount }) : t("transferReview.sign");
    return (
      <TransferReview
        header={<RequestHeader origin={origin} icon={siteIcon} requestType={requestTypeText(origin, transfer, t)} />}
        request={transfer}
        from={from}
        context={context}
        risk={assessment ?? { firstTime: false, lookalikeOf: null, unchecked: true }}
        footer={(warned) => (
          <ReviewButtons
            secondaryLabel={own ? t("transferReview.cancel") : t("transferReview.reject")}
            onSecondary={onReject}
            primaryLabel={submitting ? t("approval.signing") : own ? t("transferReview.send") : signLabel}
            onPrimary={() => void handleSign()}
            warned={warned}
            busy={submitting}
          />
        )}
      >
        {errorLine}
      </TransferReview>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <RequestHeader origin={origin} icon={siteIcon} requestType={actionCopy(preview, t)} />

      <div className="flex flex-1 flex-col gap-4 px-6 pb-6 pt-6 phone:px-5">
        {preview.kind === "pointsProof" ? (
          <p className="text-label leading-relaxed text-muted">{t("approval.pointsProofIntro")}</p>
        ) : null}

        {preview.fee !== null ? (
          <div className="flex items-center justify-between gap-4 text-label">
            <span className="text-muted">{t("approval.networkFee")}</span>
            <span className="text-right font-semibold tabular-nums text-foreground">{formatFee(preview.fee)}</span>
          </div>
        ) : null}

        {unreadable ? <RiskNotice>{t("transferReview.unreadableTokenTransfer")}</RiskNotice> : null}

        {preview.items ? (
          <div className="flex flex-col gap-3">
            <span className="text-caption font-semibold uppercase tracking-wide text-muted">
              {preview.items.length === 1
                ? t("approval.oneItemToSign")
                : t("approval.manyItemsToSign", { count: preview.items.length })}
            </span>
            {preview.items.map((item, index) => (
              <DataItemCard key={index} index={index} item={item} />
            ))}
          </div>
        ) : (
          <>
            {preview.decodedData !== null && preview.decodedData !== "" ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-caption font-semibold uppercase tracking-wide text-muted">{t("approval.decodedData")}</span>
                <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-mist p-3 font-mono text-caption leading-relaxed text-foreground">
                  <UntrustedText text={preview.decodedData} />
                </div>
              </div>
            ) : null}

            {preview.tags.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-caption font-semibold uppercase tracking-wide text-muted">{t("approval.tags")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {preview.tags.map((tag, index) => (
                    <span key={index} className="break-all rounded-md bg-mist px-2 py-1 font-mono text-micro text-foreground">
                      <span className="text-muted"><UntrustedText text={tag.name} />:</span> <UntrustedText text={tag.value} />
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <AddrBlock
              label={t("approval.signingPayloadHash")}
              copyLabel={t("approval.copySigningPayloadHash")}
              value={preview.payloadHash}
            />
          </>
        )}

        {errorLine}

        <div className="mt-auto flex gap-2.5 pt-1">
          <Button type="button" variant="secondary" onClick={onReject} className="flex-1">
            {t("approval.reject")}
          </Button>
          <Button
            type="button"
            variant={unreadable ? "destructive" : "primary"}
            disabled={submitting}
            aria-busy={submitting}
            onClick={() => void handleSign()}
            className="flex-1"
          >
            {submitting ? t("approval.signing") : actionCopy(preview, t)}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddrBlock({ label, copyLabel, value }: { label: string; copyLabel: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-semibold uppercase tracking-wide text-muted">{label}</span>
      <div className="flex items-start gap-2 rounded-md border border-line bg-background p-3">
        <span className="flex-1 break-all font-mono text-caption leading-relaxed text-foreground">{value}</span>
        <button
          type="button"
          aria-label={copyLabel}
          onClick={() => void copyToClipboard(value)}
          className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md text-faint hover:bg-mist hover:text-muted"
        >
          <CopyIcon />
        </button>
      </div>
    </div>
  );
}

