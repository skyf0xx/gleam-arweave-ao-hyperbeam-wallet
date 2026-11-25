import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  capabilityRefusal,
  collectibleSendRefusal,
  isHardwareWalletMethod,
  matchUserError,
  type Collectible,
  type CollectibleRef,
  type RuntimePort,
  type TransferFeeQuote,
  type WalletSummary,
} from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { CollectibleThumbnail } from "@gleam/ui/src/components/wallet/index.ts";
import { useAddressIdentity } from "../../../address-identity";
import { t, useT } from "../../../i18n";
import { useActivity } from "../../activity/src/useActivity";
import { useSendCollectible } from "../../activity/src/useSendCollectible";
import { firstIssueMessage, recipientSchema } from "./sendFormSchema";
import { useLookalikeOf } from "./useLookalikeOf";
import { namedSuggestions, NetworkFeeLine, RecipientField, SavedAddressesStep, SuccessStep } from "./SendView";
import { fetchCollectibleFeeQuote, useCollectibleFeeQuote, useRecipientAssessment } from "./useSendQuotes";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { errorText } from "../../../i18n/errors";
import { ReviewButtons, TransferReview } from "../../../transfer-review/TransferReview";
import type { TransferRequest } from "../../../transfer-review/model";
import { useKnownAddresses } from "./useKnownAddresses";

/**
 * Compose → review → success for one collectible: recipient only, since
 * a collectible is sent whole. The network fee is AR, quoted while the
 * recipient is entered and fixed on Review send.
 */
export interface SendCollectibleViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  collectible: Collectible;
  onBack: () => void;
  onDone: () => void;
}

type Step =
  | {
      kind: "compose";
      recipient: string;
      submitting: boolean;
      recipientError?: string;
      error?: string;
      showSaveAddress: boolean;
      saveAddressName: string;
    }
  | { kind: "saved-addresses"; recipient: string }
  | { kind: "review"; recipient: string; estimate: TransferFeeQuote; submitting: boolean; error?: string }
  | { kind: "success"; txId: string; recipient: string };

const composeStep = (recipient = ""): Extract<Step, { kind: "compose" }> => ({
  kind: "compose",
  recipient,
  submitting: false,
  showSaveAddress: false,
  saveAddressName: "",
});

function recipientError(recipient: string, ownAddress: string, assetId: string): string | undefined {
  const result = recipientSchema.safeParse(recipient);
  if (!result.success) return firstIssueMessage(result.error, t("send.invalidAddress"));
  const refusal = collectibleSendRefusal({ sender: ownAddress, recipient: result.data, assetId });
  return refusal === null ? undefined : errorText(refusal);
}

function refOf(collectible: Collectible): CollectibleRef {
  return {
    id: collectible.id,
    name: collectible.name,
    ...(collectible.imageUrl !== undefined ? { imageUrl: collectible.imageUrl } : {}),
  };
}

export function SendCollectibleView({ runtime, wallet, collectible, onBack, onDone }: SendCollectibleViewProps) {
  const t = useT();
  const [step, setStep] = useState<Step>(composeStep());
  const sendMutation = useSendCollectible(runtime, wallet.address);
  const known = useKnownAddresses(runtime, wallet.id);
  const { contacts, otherWallets, contactFor, ownWalletFor, saveContactMutation } = known;
  const activityQuery = useActivity(runtime, wallet.address);
  const identity = useAddressIdentity();
  const { emphasisPick } = identity;
  const composeLookalikeOf = useLookalikeOf(
    runtime,
    wallet,
    step.kind === "compose" ? step.recipient : "",
    contacts,
    otherWallets,
  );
  const queryClient = useQueryClient();
  const ref = refOf(collectible);
  // Only a recipient the send would accept is quoted; the others fail Continue with their own message.
  const quotedRecipient =
    step.kind === "review"
      ? step.recipient
      : step.kind === "compose" && recipientError(step.recipient, wallet.address, collectible.id) === undefined
        ? recipientSchema.safeParse(step.recipient).data
        : undefined;
  const feeQuoteQuery = useCollectibleFeeQuote(runtime, wallet.id, step.kind === "compose" ? quotedRecipient : undefined, ref);
  const assessmentQuery = useRecipientAssessment(runtime, wallet.id, quotedRecipient);

  if (step.kind === "compose") {
    const unsupported = capabilityRefusal(wallet.method, "signTransaction", "send collectibles");
    const parsed = recipientSchema.safeParse(step.recipient);
    // A gateway failure can clear on retry; a balance short of the fee can't, so Review waits for AR.
    const feeUncovered =
      feeQuoteQuery.isError && matchUserError(feeQuoteQuery.error.message)?.code === "networkFeeNeeded";
    const canContinue = !step.submitting && unsupported === null && parsed.success && !feeUncovered;

    const handleContinue = async () => {
      const error = recipientError(step.recipient, wallet.address, collectible.id);
      if (error !== undefined || !parsed.success) {
        setStep({ ...step, recipientError: error });
        return;
      }
      const recipient = parsed.data;
      setStep({ ...step, submitting: true, recipientError: undefined, error: undefined });
      try {
        const estimate = await fetchCollectibleFeeQuote(queryClient, runtime, wallet.id, recipient, ref);
        setStep({ kind: "review", recipient, estimate, submitting: false });
      } catch (estimateError) {
        setStep({
          ...step,
          submitting: false,
          error: errorText(estimateError),
        });
      }
    };

    return (
      <div className="flex min-h-full flex-col">
        <ScreenHeader title={t("send.sendCollectible")} onBack={onBack} />
        <div className="flex flex-1 flex-col gap-6 px-5 py-5 phone:pb-0">
          <div className="flex items-center gap-3">
            <CollectibleThumbnail
              name={collectible.name}
              imageUrl={collectible.imageUrl}
              nameLabel={collectible.permawebName?.label}
              className="w-12 flex-shrink-0 rounded-md"
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-label font-semibold text-foreground">{collectible.name}</span>
              <span className="text-caption text-muted">{t("send.fromWallet", { name: wallet.name })}</span>
            </div>
          </div>

          <RecipientField
            recipient={step.recipient}
            recipientError={step.recipientError}
            knownName={parsed.success ? (contactFor(parsed.data) ?? ownWalletFor(parsed.data))?.name : undefined}
            emphasisPick={emphasisPick}
            lookalikeOf={composeLookalikeOf}
            suggestions={namedSuggestions(contacts, otherWallets, activityQuery.data)}
            onChangeRecipient={(recipient) =>
              setStep({ ...step, recipient, recipientError: undefined, error: undefined, showSaveAddress: false, saveAddressName: "" })
            }
            onBlurRecipient={() => {
              if (step.recipient.trim().length === 0) return;
              setStep({ ...step, recipientError: recipientError(step.recipient, wallet.address, collectible.id) });
            }}
            onOpenSavedAddresses={() => setStep({ kind: "saved-addresses", recipient: step.recipient })}
            hideSaveOption={
              parsed.success &&
              (parsed.data === wallet.address || parsed.data === collectible.id || contactFor(parsed.data) !== undefined || ownWalletFor(parsed.data) !== undefined)
            }
            showSaveAddress={step.showSaveAddress}
            saveAddressName={step.saveAddressName}
            onToggleSaveAddress={() => setStep({ ...step, showSaveAddress: !step.showSaveAddress, saveAddressName: "" })}
            onChangeSaveAddressName={(saveAddressName) => setStep({ ...step, saveAddressName })}
            onConfirmSaveAddress={() => {
              const name = step.saveAddressName.trim();
              if (!parsed.success || name.length === 0) return;
              saveContactMutation.mutate(
                { address: parsed.data, name },
                { onSuccess: () => setStep({ ...step, showSaveAddress: false, saveAddressName: "" }) },
              );
            }}
            savingAddress={saveContactMutation.isPending}
          />

          {/* A collectible send has no amount field to carry a failed quote, so the reason shows where the fee would. */}
          {quotedRecipient !== undefined && unsupported === null && !step.error ? (
            feeQuoteQuery.isError ? (
              <InlineError size="label" as="div">
                {errorText(feeQuoteQuery.error)}
              </InlineError>
            ) : (
              <NetworkFeeLine quote={feeQuoteQuery} />
            )
          ) : null}

          {unsupported ? (
            <p role="status" className="rounded-md border border-l-[3px] border-line border-l-warning bg-mist px-3.5 py-3 text-label leading-snug text-foreground">
              {errorText(unsupported)}
            </p>
          ) : null}

          {step.error ? (
            <InlineError size="label" as="div">
              {step.error}
            </InlineError>
          ) : null}

          <ScreenFooter>
            <Button type="button" disabled={!canContinue} aria-busy={step.submitting} onClick={() => void handleContinue()}>
              {step.submitting ? t("send.estimatingFee") : parsed.success ? t("send.reviewAndSend") : t("send.enterAddress")}
            </Button>
          </ScreenFooter>
        </div>
      </div>
    );
  }

  if (step.kind === "saved-addresses") {
    return (
      <SavedAddressesStep
        runtime={runtime}
        wallet={wallet}
        {...known.listProps}
        onSelect={(recipient) => setStep(composeStep(recipient))}
        onBack={() => setStep(composeStep(step.recipient))}
      />
    );
  }

  if (step.kind === "review") {
    const known = contactFor(step.recipient) ?? ownWalletFor(step.recipient);
    // Send waits for the history check, so a warning can't arrive after the tap. A failed check reads as first-time.
    const checkingRecipient = assessmentQuery.isPending && !known;
    const assessment = assessmentQuery.data;
    const signsOnDevice = isHardwareWalletMethod(wallet.method);

    const handleSign = async () => {
      setStep({ ...step, submitting: true, error: undefined });
      try {
        const { txId } = await sendMutation.mutateAsync({
          walletId: wallet.id,
          recipient: step.recipient,
          collectible: refOf(collectible),
          fee: step.estimate.fee,
        });
        setStep({ kind: "success", txId, recipient: step.recipient });
      } catch (sendError) {
        setStep({ ...step, submitting: false, error: errorText(sendError) });
      }
    };

    const request: TransferRequest = {
      transfers: [
        {
          token: collectible.id,
          ticker: null,
          denomination: 0,
          amount: "1",
          recipient: step.recipient,
          collectible: refOf(collectible),
          part: { tags: [], decodedData: null, payloadHash: null },
          index: 0,
        },
      ],
      others: [],
      fee: step.estimate.fee,
      method: null,
      itemCount: 1,
    };

    return (
      <TransferReview
        header={<ScreenHeader title={t("send.reviewSend")} onBack={() => setStep(composeStep(step.recipient))} busy={step.submitting} />}
        request={request}
        from={{ name: wallet.name, address: wallet.address }}
        toName={known?.name ?? null}
        context={{}}
        risk={{
          firstTime: !known && !checkingRecipient && (assessment?.firstTime ?? true),
          lookalikeOf: known ? null : (assessment?.lookalikeOf ?? null),
        }}
        footer={(warned) => (
          <div className="mt-auto flex flex-col px-6 phone:px-5">
            <ScreenFooter pinned={false} className="pb-6 pt-5">
              <ReviewButtons
                secondaryLabel={t("transferReview.cancel")}
                onSecondary={onBack}
                primaryLabel={
                  step.submitting
                    ? signsOnDevice
                      ? t("send.waitingForApproval")
                      : t("send.sending")
                    : checkingRecipient
                      ? t("send.checkingRecipient")
                      : t("transferReview.send")
                }
                onPrimary={() => void handleSign()}
                warned={warned}
                busy={step.submitting || checkingRecipient}
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

  return (
    <SuccessStep
      summary={t("send.summary", { amount: collectible.name, recipient: step.recipient })}
      txId={step.txId}
      onDone={onDone}
      {...known.successSaveProps(step.recipient)}
    />
  );
}
