import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isHardwareWalletMethod, type RuntimePort, type TokenBalance, type TransferFeeQuote, type WalletSummary } from "@gleam/core";
import { ContactsView } from "../../contacts/index.tsx";
import { useAddressIdentity } from "../../../address-identity";
import { useT } from "../../../i18n";
import { useDisplaySettings } from "../../../display-settings";
import { DEFAULT_AO_TOKEN } from "@gleam/ui";
import { AR_DENOMINATION, formatWinstonAsAr, parseDisplayToAtomic } from "../../main-screen/src/formatWinston";
import { useOrderbookPrices, useTokenPrices } from "../../main-screen/src/useTokenPrices";
import { useActivity } from "../../activity/src/useActivity";
import { useArFee } from "../../activity/src/useArFee";
import { useBalances } from "../../activity/src/useBalances";
import { useSubmitTransfer } from "../../activity/src/useSubmitTransfer";
import { validateSendAmount } from "../../activity/src/validateSendAmount";
import { amountSchema, firstIssueMessage, recipientSchema } from "./sendFormSchema";
import { useLookalikeOf } from "./useLookalikeOf";
import { fetchSendFeeQuote, useRecipientAssessment, useSendFeeQuote } from "./useSendQuotes";
import { readRowVisibility } from "../../../token-visibility";
import { errorText } from "../../../i18n/errors";
import { useKnownAddresses } from "./useKnownAddresses";
import { ComposeStep } from "./ComposeStep";
import { namedSuggestions } from "./namedAddresses";
import { ReviewStep } from "./ReviewStep";
import { SavedAddressesStep } from "./SavedAddressesStep";
import { INITIAL_STEP, type Step } from "./sendStep";
import { formatAmount, priceFor, tickerFor } from "./sendTokenFormat";
import { SuccessStep } from "./SuccessStep";
import { TokenPickerStep } from "./TokenPickerStep";

/**
 * Compose → review → success, internal step state only (same "no router"
 * pattern as Onboarding/UnlockView). `ComposeStep`/`ReviewStep`/
 * `SuccessStep` are pure render components, not independently-mounted
 * steps, matching how `OnboardingView` structures its own switch.
 * `TokenPickerStep`/`SavedAddressesStep` are two more pushed screens in
 * the same internal `Step` union, following this codebase's established
 * "pushed screen with ScreenHeader + rows" pattern (`WalletSwitcherView.tsx`)
 * rather than a dropdown/modal primitive.
 *
 * Address book (minimal, per `todo.md`'s "Address book, part 1"): the
 * label that used to read "Recent" is now "Saved contacts" everywhere in
 * this view, and that pushed screen shows saved contacts (`useContacts`)
 * above recent send recipients, deduped by address (a saved contact wins
 * over its plain recent-recipient row). Saving a new address is
 * deliberately quiet: pasting/bluring onto a full, valid, not-yet-saved
 * address reveals one line, "Save this address", which expands into a
 * name field in place — no modal, no separate screen. The same "Save as
 * contact" line reappears on the success screen for a send to an address
 * that still isn't saved.
 *
 * No password prompt here: `estimateTransfer`/`submitTransfer` read the
 * signing key from the background's in-memory unlocked-session cache
 * (`packages/runtime/src/handlers/key-session.ts`), not from this request —
 * see that file's doc comment. `App.tsx`'s `resolveTopView` already keeps
 * an unauthenticated user on the unlock screen, so `SendView` only ever
 * mounts once a wallet is unlocked.
 *
 * `token`: the initial value is `App.tsx`'s entry-point context (`null`
 * for the top-level "Send" action, a `TokenBalance` for a per-token row
 * click on `MainScreenView`), but the compose step's own token picker can
 * change it before continuing — `selectedToken` local state (not the
 * `token` prop) is what `handleContinue`/the compose/review/success steps
 * actually read from this point on. `null` is always the AR path; every
 * entry from `getTokenBalances` is an AO token. Every listed token — AR or
 * AO — is genuinely sendable through this one flow; there is no
 * disabled/"coming soon" branch.
 */
export interface SendViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  token: TokenBalance | null;
  /** Prefills the recipient, as when opened from an activity entry. */
  recipient?: string;
  onBack: () => void;
  onDone: () => void;
}

/** True for a full, valid Arweave address (`recipientSchema`'s own shape). */
function isFullAddress(value: string): boolean {
  return recipientSchema.safeParse(value).success;
}

export function SendView({ runtime, wallet, token, recipient, onBack, onDone }: SendViewProps) {
  const t = useT();
  const [step, setStep] = useState<Step>(() => ({ ...INITIAL_STEP, recipient: recipient ?? "" }));
  // Store the compose step state when opening the token picker so we can restore it
  const [savedComposeStep, setSavedComposeStep] = useState<Extract<Step, { kind: "compose" }> | null>(null);
  // The in-flow-selectable token: the compose step's own token picker can
  // change this before continuing. Initialized from the `token` prop —
  // `App.tsx`'s entry-point context — but from here on this state, not the
  // prop, is authoritative; the prop never changes identity across
  // `SendView`'s lifetime (no `useEffect` re-sync needed).
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(token);
  // Held here, not in the compose step, so a trip to the token picker
  // comes back to the view it left.
  const [showInfo, setShowInfo] = useState(false);
  // Shared cache with `MainScreenView` (`useBalances`, keyed by
  // `wallet.address`) — the compose step's client-side "insufficient
  // balance" check reads this same query's current data rather than
  // issuing its own fetch.
  const balancesQuery = useBalances(runtime, wallet.address);
  // AR-only network fee estimate, independent of the balances query — feeds
  // the compose step's "Max" affordance and its balance check (see
  // `useArFee`'s own doc comment for why it isn't wallet-address-keyed).
  const arFeeQuery = useArFee(runtime);
  const displaySettings = useDisplaySettings(runtime).settings;
  const currency = displaySettings?.currency;
  const tokenLogos = displaySettings?.tokenLogos ?? true;
  const tokenPricesQuery = useTokenPrices(runtime, currency);
  // Only a token added by hand is priced from its orderbook, as on the main screen.
  const orderbookPricesQuery = useOrderbookPrices(
    runtime,
    currency,
    selectedToken !== null &&
      selectedToken.processId !== DEFAULT_AO_TOKEN.processId &&
      selectedToken.source !== "discovered" &&
      selectedToken.available !== false
      ? [selectedToken.processId]
      : [],
  );
  // Invalidates the shared balances/activity cache for `wallet.address` on
  // success so both Send and Main Screen reflect the updated balance
  // without a manual popup reopen, wrapping the same `submitTransfer` call
  // this view already made directly.
  const submitTransferMutation = useSubmitTransfer(runtime, wallet.address);
  // Address book: one vault-wide list, not scoped to `wallet.address` (see
  // `useContacts`'s own doc comment). Drives the saved-addresses screen,
  // the "already saved" check that hides "Save this address", and the
  // known-recipient framing on Review/Success.
  const known = useKnownAddresses(runtime, wallet.id);
  const { contacts, otherWallets, contactFor, ownWalletFor, knownNameFor, saveContactMutation } = known;
  // Shared cache with the main screen; orders the recipient dropdown.
  const activityQuery = useActivity(runtime, wallet.address);
  const { emphasisPick } = useAddressIdentity();
  const queryClient = useQueryClient();
  const tokenId = selectedToken === null ? null : selectedToken.processId;
  const quotedRecipient =
    step.kind === "compose" ? recipientSchema.safeParse(step.recipient).data : step.kind === "review" ? step.recipient : undefined;
  const feeQuoteQuery = useSendFeeQuote(runtime, wallet.id, step.kind === "compose" ? quotedRecipient : undefined, tokenId);
  const assessmentQuery = useRecipientAssessment(runtime, wallet.id, quotedRecipient);
  const lookalikeOf = useLookalikeOf(
    runtime,
    wallet,
    step.kind === "compose" ? step.recipient : "",
    contacts,
    otherWallets,
  );

  if (step.kind === "compose") {
    const handleContinue = async () => {
      const recipientResult = recipientSchema.safeParse(step.recipient);
      if (!recipientResult.success) {
        setStep({
          ...step,
          recipientError: firstIssueMessage(recipientResult.error, t("send.invalidAddress")),
          amountError: undefined,
        });
        return;
      }
      const recipient = recipientResult.data;

      const denomination = selectedToken === null ? 12 : selectedToken.denomination;
      const amountResult = amountSchema(denomination).safeParse(step.amountDisplay);
      if (!amountResult.success) {
        setStep({
          ...step,
          recipientError: undefined,
          amountError: firstIssueMessage(amountResult.error, t("send.invalidAmount")),
        });
        return;
      }
      const amountAtomic =
        selectedToken === null
          ? parseDisplayToAtomic(amountResult.data, AR_DENOMINATION)
          : parseDisplayToAtomic(amountResult.data, selectedToken.denomination);
      if (amountAtomic === null) {
        setStep({ ...step, recipientError: undefined, amountError: t("send.invalidAmount") });
        return;
      }

      const balanceError = validateSendAmount(amountAtomic, selectedToken, balancesQuery.data, arFeeQuery.data);
      if (balanceError !== null) {
        setStep({ ...step, recipientError: undefined, amountError: balanceError });
        return;
      }

      setStep({ ...step, submitting: true, recipientError: undefined, amountError: undefined });
      try {
        const estimate = await fetchSendFeeQuote(queryClient, runtime, wallet.id, recipient, tokenId);

        // getArFee's recipient-less quote underestimates for a first-seen
        // recipient (see its doc comment) — recheck the balance now that
        // estimateTransfer has the real, recipient-specific fee.
        const feeIsNewAddress =
          estimate.fee !== null && arFeeQuery.data !== undefined && BigInt(estimate.fee) > BigInt(arFeeQuery.data);
        const finalBalanceError = validateSendAmount(
          amountAtomic,
          selectedToken,
          balancesQuery.data,
          estimate.fee ?? undefined,
          feeIsNewAddress,
        );
        if (finalBalanceError !== null) {
          setStep({ ...step, submitting: false, recipientError: undefined, amountError: finalBalanceError });
          return;
        }

        setStep({
          kind: "review",
          recipient,
          amountAtomic,
          amountDisplay: step.amountDisplay,
          estimate,
          submitting: false,
        });
      } catch (error) {
        setStep({
          ...step,
          submitting: false,
          amountError: errorText(error),
        });
      }
    };

    return (
      <ComposeStep
        runtime={runtime}
        wallet={wallet}
        token={selectedToken}
        balancesQuery={balancesQuery}
        arFeeAtomic={arFeeQuery.data}
        feeQuote={feeQuoteQuery}
        arPrice={priceFor(tokenPricesQuery.data, null)}
        price={priceFor(tokenPricesQuery.data, selectedToken)}
        currency={currency}
        tokenLogos={tokenLogos}
        step={step}
        showInfo={showInfo}
        onShowInfo={setShowInfo}
        knownName={knownNameFor(recipientSchema.safeParse(step.recipient).data ?? "")}
        emphasisPick={emphasisPick}
        lookalikeOf={lookalikeOf}
        suggestions={namedSuggestions(contacts, otherWallets, activityQuery.data)}
        onBack={onBack}
        onChange={(patch) =>
          setStep({
            ...step,
            ...patch,
            recipientError: "recipient" in patch ? undefined : step.recipientError,
            amountError: "amountDisplay" in patch ? undefined : step.amountError,
            showSaveAddress: "recipient" in patch ? false : step.showSaveAddress,
            saveAddressName: "recipient" in patch ? "" : step.saveAddressName,
          })
        }
        onBlurRecipient={() => {
          if (step.recipient.trim().length === 0) return;
          const result = recipientSchema.safeParse(step.recipient);
          setStep({
            ...step,
            recipientError: result.success
              ? undefined
              : firstIssueMessage(result.error, t("send.invalidAddress")),
          });
        }}
        hideSaveOption={
          isFullAddress(step.recipient) &&
          (contactFor(recipientSchema.safeParse(step.recipient).data ?? "") !== undefined ||
            ownWalletFor(recipientSchema.safeParse(step.recipient).data ?? "") !== undefined)
        }
        onToggleSaveAddress={() => setStep({ ...step, showSaveAddress: !step.showSaveAddress, saveAddressName: "" })}
        onChangeSaveAddressName={(saveAddressName) => setStep({ ...step, saveAddressName })}
        onConfirmSaveAddress={() => {
          const recipient = recipientSchema.safeParse(step.recipient).data;
          const name = step.saveAddressName.trim();
          if (!recipient || name.length === 0) return;
          saveContactMutation.mutate(
            { address: recipient, name },
            { onSuccess: () => setStep({ ...step, showSaveAddress: false, saveAddressName: "" }) },
          );
        }}
        savingAddress={saveContactMutation.isPending}
        onBlurAmount={() => {
          if (step.amountDisplay.trim().length === 0) return;
          const denomination = selectedToken === null ? 12 : selectedToken.denomination;
          const result = amountSchema(denomination).safeParse(step.amountDisplay);
          setStep({
            ...step,
            amountError: result.success ? undefined : firstIssueMessage(result.error, t("send.invalidAmount")),
          });
        }}
        onContinue={() => void handleContinue()}
        onOpenTokenPicker={() => {
          setSavedComposeStep(step);
          setStep({ kind: "token-picker" });
        }}
        onOpenSavedAddresses={() => {
          setSavedComposeStep(step);
          setStep({ kind: "saved-addresses" });
        }}
      />
    );
  }

  if (step.kind === "token-picker") {
    return (
      <TokenPickerStep
        walletAddress={wallet.address}
        balancesQuery={balancesQuery}
        tokenLogos={tokenLogos}
        selectedToken={selectedToken}
        onSelect={(nextToken) => {
          setSelectedToken(nextToken);
          // An amount typed for one token means nothing in another's units.
          const changed = (nextToken?.processId ?? null) !== (selectedToken?.processId ?? null);
          setStep(
            savedComposeStep && changed
              ? { ...savedComposeStep, amountDisplay: "", amountError: undefined }
              : savedComposeStep || INITIAL_STEP,
          );
          setSavedComposeStep(null);
        }}
        onBack={() => {
          setStep(savedComposeStep || INITIAL_STEP);
          setSavedComposeStep(null);
        }}
      />
    );
  }

  if (step.kind === "saved-addresses") {
    return (
      <SavedAddressesStep
        runtime={runtime}
        wallet={wallet}
        {...known.listProps}
        onSelect={(recipient) => {
          setStep({
            ...(savedComposeStep ?? INITIAL_STEP),
            recipient,
            recipientError: undefined,
            showSaveAddress: false,
            saveAddressName: "",
          });
          setSavedComposeStep(null);
        }}
        onEditContacts={() => setStep({ kind: "edit-contacts" })}
        onBack={() => {
          setStep(savedComposeStep ?? INITIAL_STEP);
          setSavedComposeStep(null);
        }}
      />
    );
  }

  if (step.kind === "edit-contacts") {
    return <ContactsView runtime={runtime} onBack={() => setStep({ kind: "saved-addresses" })} />;
  }

  const requote = async (recipient: string): Promise<TransferFeeQuote | null> => {
    try {
      await queryClient.invalidateQueries({ queryKey: ["sendFeeQuote", wallet.id, recipient, tokenId] });
      return await fetchSendFeeQuote(queryClient, runtime, wallet.id, recipient, tokenId);
    } catch {
      return null;
    }
  };

  if (step.kind === "review") {
    const handleSign = async () => {
      setStep({ ...step, submitting: true, error: undefined });
      try {
        const result = await submitTransferMutation.mutateAsync({
          walletId: wallet.id,
          recipient: step.recipient,
          token: selectedToken === null ? null : selectedToken.processId,
          amount: step.amountAtomic,
          fee: step.estimate.fee,
        });
        setStep({ kind: "success", txId: result.txId, recipient: step.recipient, amountAtomic: step.amountAtomic });
      } catch (error) {
        console.error("submitTransfer failed:", error);
        const failed = errorText(error);
        // The fee is pinned at review, so a quote the network has since
        // outgrown fails every retry. Re-quote, and if the fee moved, show
        // the new one and wait for another tap: it is never signed unseen.
        const estimate = step.estimate.fee === null ? null : await requote(step.recipient);
        if (estimate === null || estimate.fee === null || estimate.fee === step.estimate.fee) {
          setStep({ ...step, submitting: false, error: failed });
          return;
        }
        const balanceError = validateSendAmount(step.amountAtomic, selectedToken, balancesQuery.data, estimate.fee);
        setStep({
          ...step,
          estimate,
          submitting: false,
          error: balanceError ?? t("send.feeChanged", { fee: `${formatWinstonAsAr(estimate.fee, 12)} AR` }),
        });
      }
    };

    return (
      <ReviewStep
        token={selectedToken}
        wallet={wallet}
        context={{
          address: wallet.address,
          balances: balancesQuery.data,
          prices: [...(tokenPricesQuery.data ?? []), ...(orderbookPricesQuery.data ?? [])],
          currency,
          tokenLogos,
          balancesHidden: displaySettings?.balancesHidden ?? false,
          visibility: readRowVisibility(wallet.address),
        }}
        step={step}
        assessment={assessmentQuery.data}
        checkingRecipient={assessmentQuery.isPending}
        contact={contactFor(step.recipient)}
        ownWallet={ownWalletFor(step.recipient)}
        signsOnDevice={isHardwareWalletMethod(wallet.method)}
        onBack={() => setStep({ ...INITIAL_STEP, recipient: step.recipient, amountDisplay: step.amountDisplay })}
        onCancel={onBack}
        onSign={() => void handleSign()}
      />
    );
  }

  return (
    <SuccessStep
      summary={t("send.summary", { amount: `${formatAmount(step.amountAtomic, selectedToken)} ${tickerFor(selectedToken)}`, recipient: step.recipient })}
      txId={step.txId}
      onDone={onDone}
      {...known.successSaveProps(step.recipient)}
    />
  );
}
