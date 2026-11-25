import { impersonatesRegisteredToken, isRegisteredProcessId, type Contact, type RecipientAssessment, type TokenBalance, type WalletSummary } from "@gleam/core";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { useT } from "../../../i18n";
import { ReviewButtons, TransferReview } from "../../../transfer-review/TransferReview";
import type { RecipientRisk, TransferContext, TransferRequest } from "../../../transfer-review/model";
import type { Step } from "./sendStep";
import { tickerFor } from "./sendTokenFormat";

export function ReviewStep({
  token,
  wallet,
  context,
  step,
  assessment,
  checkingRecipient,
  contact,
  ownWallet,
  signsOnDevice,
  onBack,
  onCancel,
  onSign,
}: {
  token: TokenBalance | null;
  wallet: WalletSummary;
  context: TransferContext;
  step: Extract<Step, { kind: "review" }>;
  /** The background's history check; `undefined` while it runs or if it failed. */
  assessment: RecipientAssessment | undefined;
  /** Send waits for the history check, so a warning can't arrive after the tap. */
  checkingRecipient: boolean;
  /** A saved contact for `step.recipient`, if any — a known recipient skips first-seen framing. */
  contact: Contact | undefined;
  /** One of the vault's own other wallets, if `step.recipient` is its address — same known-recipient treatment as a saved contact. */
  ownWallet: WalletSummary | undefined;
  /** A hardware wallet signs in the approval window the background opens; the popup may close when it takes focus. */
  signsOnDevice: boolean;
  onBack: () => void;
  /** Leaves the send flow; `onBack` only returns to the form. */
  onCancel: () => void;
  onSign: () => void;
}) {
  const t = useT();
  // A saved contact or one of your own wallets counts as a known recipient
  // even before the history check answers. A failed check reads as first-time.
  const known = contact ?? ownWallet;
  const risk: RecipientRisk = {
    firstTime: !known && !checkingRecipient && (assessment?.firstTime ?? true),
    lookalikeOf: known ? null : (assessment?.lookalikeOf ?? null),
  };
  const request: TransferRequest = {
    transfers: [
      {
        token: token === null ? null : token.processId,
        ticker: tickerFor(token),
        denomination: token === null ? 12 : token.denomination,
        amount: step.amountAtomic,
        recipient: step.recipient,
        part: { tags: [], decodedData: null, payloadHash: null },
        index: 0,
        // As a dApp's transfer is flagged: a watched token may predate the add-time refusal.
        ...(token !== null &&
        !isRegisteredProcessId(token.processId) &&
        impersonatesRegisteredToken({ ticker: token.ticker, name: token.name })
          ? { impersonating: true as const }
          : {}),
      },
    ],
    others: [],
    // A legacy AO transfer has no sender-side fee (`estimate.fee` is `null`).
    fee: step.estimate.fee,
    method: null,
    itemCount: 1,
  };

  return (
    <TransferReview
      header={<ScreenHeader title={t("send.reviewSend")} onBack={onBack} busy={step.submitting} />}
      request={request}
      from={{ name: wallet.name, address: wallet.address }}
      toName={known?.name ?? null}
      context={context}
      risk={risk}
      footer={(warned) => (
        <div className="mt-auto flex flex-col px-6 phone:px-5">
          <ScreenFooter pinned={false} className="pb-6 pt-5">
            {warned ? null : <p className="text-center text-label text-muted">{t("send.cannotBeUndone")}</p>}
            <ReviewButtons
              secondaryLabel={t("transferReview.cancel")}
              onSecondary={onCancel}
              primaryLabel={
                step.submitting
                  ? signsOnDevice
                    ? t("send.waitingForApproval")
                    : t("send.sending")
                  : checkingRecipient && !known
                    ? t("send.checkingRecipient")
                    : t("transferReview.send")
              }
              onPrimary={onSign}
              warned={warned}
              busy={step.submitting || (checkingRecipient && !known)}
              className="mt-0 p-0 phone:px-0"
            />
          </ScreenFooter>
        </div>
      )}
    >
      {step.error ? (
        <InlineError size="label" as="div">
          {step.error}
        </InlineError>
      ) : null}
      {step.submitting && signsOnDevice ? (
        <p role="status" className="text-label leading-snug text-muted">
          {t("send.approveOnDevice")}
        </p>
      ) : null}
    </TransferReview>
  );
}
