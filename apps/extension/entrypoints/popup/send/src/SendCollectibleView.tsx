import { useState } from "react";
import {
  capabilityRefusal,
  collectibleSendRefusal,
  isHardwareWalletMethod,
  type Collectible,
  type CollectibleRef,
  type CollectibleSendDraft,
  type Contact,
  type FeeEstimate,
  type RuntimePort,
  type WalletSummary,
} from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { RiskNotice } from "@gleam/ui/src/primitives/risk-notice.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { CollectibleThumbnail } from "@gleam/ui/src/components/wallet/index.ts";
import { formatWinstonAsAr } from "../../main-screen/src/formatWinston";
import { useContacts, useSaveContact } from "../../activity/src/useContacts";
import { useOtherWallets } from "../../activity/src/useOtherWallets";
import { useSendCollectible } from "../../activity/src/useSendCollectible";
import { firstIssueMessage, recipientSchema } from "./sendFormSchema";
import { RecipientField, ReviewRow, SavedAddressesStep, SuccessStep } from "./SendView";

/**
 * Compose → review → success for one collectible: recipient only, since
 * a collectible is sent whole. The network fee is AR, quoted on Continue.
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
  | { kind: "review"; recipient: string; estimate: FeeEstimate; submitting: boolean; error?: string }
  | { kind: "success"; txId: string; recipient: string };

const composeStep = (recipient = ""): Extract<Step, { kind: "compose" }> => ({
  kind: "compose",
  recipient,
  submitting: false,
  showSaveAddress: false,
  saveAddressName: "",
});

/** Fees are often below 0.0001 AR, which the default four digits would show as 0. */
const FEE_DIGITS = 12;

function recipientError(recipient: string, ownAddress: string, assetId: string): string | undefined {
  const result = recipientSchema.safeParse(recipient);
  if (!result.success) return firstIssueMessage(result.error, "That doesn't look like a valid address.");
  return collectibleSendRefusal({ sender: ownAddress, recipient: result.data, assetId }) ?? undefined;
}

function refOf(collectible: Collectible): CollectibleRef {
  return {
    id: collectible.id,
    name: collectible.name,
    ...(collectible.imageUrl !== undefined ? { imageUrl: collectible.imageUrl } : {}),
  };
}

export function SendCollectibleView({ runtime, wallet, collectible, onBack, onDone }: SendCollectibleViewProps) {
  const [step, setStep] = useState<Step>(composeStep());
  const sendMutation = useSendCollectible(runtime, wallet.address);
  const contactsQuery = useContacts(runtime);
  const saveContactMutation = useSaveContact(runtime);
  const otherWalletsQuery = useOtherWallets(runtime, wallet.id);
  const contactFor = (address: string): Contact | undefined =>
    contactsQuery.data?.find((candidate) => candidate.address === address);
  const ownWalletFor = (address: string): WalletSummary | undefined =>
    otherWalletsQuery.data?.find((candidate) => candidate.address === address);

  if (step.kind === "compose") {
    const unsupported = capabilityRefusal(wallet.method, "signTransaction", "send collectibles");
    const parsed = recipientSchema.safeParse(step.recipient);
    const canContinue = !step.submitting && unsupported === null && parsed.success;

    const handleContinue = async () => {
      const error = recipientError(step.recipient, wallet.address, collectible.id);
      if (error !== undefined || !parsed.success) {
        setStep({ ...step, recipientError: error });
        return;
      }
      const recipient = parsed.data;
      setStep({ ...step, submitting: true, recipientError: undefined, error: undefined });
      try {
        const estimate = await runtime.send<CollectibleSendDraft, FeeEstimate>({
          type: "estimateCollectibleSend",
          payload: { walletId: wallet.id, recipient, collectible: refOf(collectible) },
        });
        setStep({ kind: "review", recipient, estimate, submitting: false });
      } catch (estimateError) {
        setStep({
          ...step,
          submitting: false,
          error: estimateError instanceof Error ? estimateError.message : String(estimateError),
        });
      }
    };

    return (
      <div className="flex min-h-full flex-col">
        <ScreenHeader title="Send collectible" onBack={onBack} />
        <div className="flex flex-1 flex-col gap-6 px-5 py-5">
          <div className="flex items-center gap-3">
            <CollectibleThumbnail name={collectible.name} imageUrl={collectible.imageUrl} className="w-12 flex-shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-label font-semibold text-foreground">{collectible.name}</span>
              <span className="text-caption text-muted">From {wallet.name}</span>
            </div>
          </div>

          <RecipientField
            recipient={step.recipient}
            recipientError={step.recipientError}
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

          {unsupported ? (
            <p role="status" className="rounded-md border border-l-[3px] border-line border-l-warning bg-mist px-3.5 py-3 text-label leading-snug text-foreground">
              {unsupported}
            </p>
          ) : null}

          {step.error ? (
            <div role="alert" className="text-label leading-snug text-warning">
              {step.error}
            </div>
          ) : null}

          <Button type="button" disabled={!canContinue} aria-busy={step.submitting} onClick={() => void handleContinue()} className="mt-auto">
            {step.submitting ? "Checking…" : "Continue"}
          </Button>
        </div>
      </div>
    );
  }

  if (step.kind === "saved-addresses") {
    return (
      <SavedAddressesStep
        runtime={runtime}
        wallet={wallet}
        contacts={contactsQuery.data ?? []}
        contactsLoading={contactsQuery.isLoading}
        otherWallets={otherWalletsQuery.data ?? []}
        otherWalletsLoading={otherWalletsQuery.isLoading}
        onSelect={(recipient) => setStep(composeStep(recipient))}
        onBack={() => setStep(composeStep(step.recipient))}
      />
    );
  }

  if (step.kind === "review") {
    const known = contactFor(step.recipient) ?? ownWalletFor(step.recipient);
    const irreversible = step.estimate.firstSeenRecipient && !known;
    const signsOnDevice = isHardwareWalletMethod(wallet.method);

    const handleSign = async () => {
      setStep({ ...step, submitting: true, error: undefined });
      try {
        const { txId } = await sendMutation.mutateAsync({
          walletId: wallet.id,
          recipient: step.recipient,
          collectible: refOf(collectible),
        });
        setStep({ kind: "success", txId, recipient: step.recipient });
      } catch (sendError) {
        setStep({ ...step, submitting: false, error: sendError instanceof Error ? sendError.message : String(sendError) });
      }
    };

    return (
      <div className="flex min-h-full flex-col">
        <ScreenHeader title="Review send" onBack={() => setStep(composeStep(step.recipient))} />
        <div className="flex flex-1 flex-col gap-6 px-5 py-5">
          <div className="flex flex-col items-center gap-2 pt-2 text-center">
            <CollectibleThumbnail name={collectible.name} imageUrl={collectible.imageUrl} className="w-28" />
            <span className="break-words text-body font-semibold text-foreground">{collectible.name}</span>
          </div>

          {irreversible ? (
            <RiskNotice>
              <strong className="font-bold">You haven&apos;t sent to this address before.</strong> Double-check
              it&apos;s correct. This can&apos;t be undone once signed.
            </RiskNotice>
          ) : (
            <p className="text-label leading-relaxed text-muted">
              You&apos;re sending {collectible.name} to this address. This can&apos;t be undone.
            </p>
          )}

          <div className="flex flex-col">
            {known ? <ReviewRow label="Recipient" value={known.name} /> : null}
            <ReviewRow label="To" value={step.recipient} mono />
            <ReviewRow
              label="Network fee"
              value={step.estimate.fee === null ? "—" : `${formatWinstonAsAr(step.estimate.fee, FEE_DIGITS)} AR`}
            />
          </div>

          {step.error ? (
            <div role="alert" className="text-label leading-snug text-warning">
              {step.error}
            </div>
          ) : null}

          {step.submitting && signsOnDevice ? (
            <p role="status" className="text-label leading-snug text-muted">
              Approve on your device in the window that opened.
            </p>
          ) : null}

          <Button
            type="button"
            variant={irreversible ? "destructive" : "primary"}
            disabled={step.submitting}
            aria-busy={step.submitting}
            onClick={() => void handleSign()}
            className="mt-auto"
          >
            {step.submitting ? (signsOnDevice ? "Waiting for approval…" : "Signing…") : "Sign and send"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SuccessStep
      summary={`${collectible.name} to ${step.recipient}`}
      txId={step.txId}
      onDone={onDone}
      isSaved={contactFor(step.recipient) !== undefined || ownWalletFor(step.recipient) !== undefined}
      onSaveAddress={(name) => saveContactMutation.mutate({ address: step.recipient, name })}
      saving={saveContactMutation.isPending}
    />
  );
}
