import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { capabilityRefusal, explorerUrlFor, isHardwareWalletMethod, type ActivityPage, type Contact, type DisplayCurrency, type RecipientAssessment, type RuntimePort, type TokenBalance, type TokenPrice, type TransferFeeQuote, type WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ContactsView } from "../../contacts/index.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { SearchField } from "@gleam/ui/src/primitives/search-field.tsx";
import { AccountAvatar, EmptyState, RecipientCard, RecipientWarning, TokenGlyph, TokenRow } from "@gleam/ui/src/components/wallet/index.ts";
import { formatCurrencyValue } from "@gleam/ui/src/format/currency.ts";
import { useAddressIdentity } from "../../../address-identity";
import { t, useT } from "../../../i18n";
import { usePlatform } from "../../../app-platform/context";
import { addressFromQr, QrScanError } from "../../../app-platform/qr-scanner";
import { useDisplaySettings } from "../../../display-settings";
import { DEFAULT_AO_TOKEN, DEFAULT_AR_TOKEN } from "@gleam/ui";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import {
  AR_DENOMINATION,
  displayTicker,
  formatAtomicAsDisplay,
  formatAtomicCompact,
  formatWinstonAsAr,
  parseDisplayToAtomic,
} from "../../main-screen/src/formatWinston";
import { useOrderbookPrices, useTokenPrices } from "../../main-screen/src/useTokenPrices";
import { AddressRow } from "../../activity/src/AddressRow";
import { useActivity } from "../../activity/src/useActivity";
import { useArFee } from "../../activity/src/useArFee";
import { useBalances, type WalletBalances } from "../../activity/src/useBalances";
import { useContacts, useSaveContact } from "../../activity/src/useContacts";
import { useOtherWallets } from "../../activity/src/useOtherWallets";
import { useSubmitTransfer } from "../../activity/src/useSubmitTransfer";
import { feeFiatText } from "../../../transfer-review/model";
import { validateSendAmount } from "../../activity/src/validateSendAmount";
import { amountSchema, firstIssueMessage, recipientSchema } from "./sendFormSchema";
import { TokenInfoPanel } from "./TokenInfoPanel";
import { useLookalikeOf } from "./useLookalikeOf";
import { fetchSendFeeQuote, useRecipientAssessment, useSendFeeQuote } from "./useSendQuotes";
import { isTokenHidden, readRowVisibility, sendTokenLogo, shownTokenLogo } from "../../../token-visibility";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { errorText } from "../../../i18n/errors";
import { ReviewButtons, TransferReview } from "../../../transfer-review/TransferReview";
import { feeText, type RecipientRisk, type TransferContext, type TransferRequest } from "../../../transfer-review/model";

/**
 * Compose → review → success, internal step state only (same "no router"
 * pattern as Onboarding/UnlockView). `ComposeStep`/`ReviewStep`/
 * `SuccessStep` below are pure render helpers, not independently-mounted
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

type Step =
  | {
      kind: "compose";
      recipient: string;
      amountDisplay: string;
      submitting: boolean;
      recipientError?: string;
      amountError?: string;
      /** Toggled by "Save this address" — reveals the name field below it. */
      showSaveAddress: boolean;
      saveAddressName: string;
    }
  | { kind: "token-picker" }
  | { kind: "saved-addresses" }
  | { kind: "edit-contacts" }
  | {
      kind: "review";
      recipient: string;
      amountAtomic: string;
      amountDisplay: string;
      estimate: TransferFeeQuote;
      submitting: boolean;
      error?: string;
    }
  | { kind: "success"; txId: string; recipient: string; amountAtomic: string };

/**
 * Strips the amount input to digits and at most one decimal point as the
 * user types — commas, letters, and extra `.`s never land in the field,
 * rather than being accepted and only rejected later by `amountSchema` on
 * Continue.
 */
function sanitizeAmountInput(raw: string): string {
  const digitsAndDots = raw.replace(/[^0-9.]/g, "");
  const firstDot = digitsAndDots.indexOf(".");
  if (firstDot === -1) return digitsAndDots;
  return digitsAndDots.slice(0, firstDot + 1) + digitsAndDots.slice(firstDot + 1).replace(/\./g, "");
}

const INITIAL_STEP: Extract<Step, { kind: "compose" }> = {
  kind: "compose",
  recipient: "",
  amountDisplay: "",
  submitting: false,
  showSaveAddress: false,
  saveAddressName: "",
};

/** True for a full, valid Arweave address (`recipientSchema`'s own shape). */
function isFullAddress(value: string): boolean {
  return recipientSchema.safeParse(value).success;
}

/**
 * Shown in place of a formatted amount for a `TokenBalance` whose
 * `available` is `false` (`handlers/reads.ts`: a failed HyperBEAM read, or
 * an unconfirmed non-AO denomination) — such a row's `quantity`/
 * `denomination` can't be trusted for display or for a max-send check, so
 * the row is shown but not selectable (`onClick` omitted).
 */
const unavailableTokenBalanceLabel = () => t("send.unavailable");

/** `token.ticker` for an AO token, `"AR"` for the native token (`token === null`). */
function tickerFor(token: TokenBalance | null): string {
  return token === null ? "AR" : displayTicker(token.ticker);
}

function formatAmount(atomic: string, token: TokenBalance | null): string {
  return token === null ? formatWinstonAsAr(atomic, 12) : formatAtomicAsDisplay(atomic, token.denomination, token.denomination);
}

/** `TokenPrice.price` is `null` for a token that couldn't be priced; that reads as no price here. */
function priceFor(prices: TokenPrice[] | undefined, token: TokenBalance | null): number | undefined {
  const price = prices?.find((entry) => entry.processId === (token === null ? null : token.processId))?.price;
  return typeof price === "number" ? price : undefined;
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
  const contactsQuery = useContacts(runtime);
  const saveContactMutation = useSaveContact(runtime);
  const contactFor = (address: string): Contact | undefined =>
    contactsQuery.data?.find((candidate) => candidate.address === address);
  // The vault's other wallets — a recipient that's one of your own wallets
  // counts as known too, same as a saved contact (Review's own-wallet
  // check below), and the saved-addresses screen lists them under "Your
  // wallets".
  const otherWalletsQuery = useOtherWallets(runtime, wallet.id);
  const ownWalletFor = (address: string): WalletSummary | undefined =>
    otherWalletsQuery.data?.find((candidate) => candidate.address === address);
  const knownNameFor = (address: string): string | undefined => (contactFor(address) ?? ownWalletFor(address))?.name;
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
    contactsQuery.data ?? [],
    otherWalletsQuery.data ?? [],
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
        suggestions={namedSuggestions(contactsQuery.data ?? [], otherWalletsQuery.data ?? [], activityQuery.data)}
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
        contacts={contactsQuery.data ?? []}
        contactsLoading={contactsQuery.isLoading}
        otherWallets={otherWalletsQuery.data ?? []}
        otherWalletsLoading={otherWalletsQuery.isLoading}
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
        onSign={() => void handleSign()}
      />
    );
  }

  return (
    <SuccessStep
      summary={t("send.summary", { amount: `${formatAmount(step.amountAtomic, selectedToken)} ${tickerFor(selectedToken)}`, recipient: step.recipient })}
      txId={step.txId}
      onDone={onDone}
      isSaved={contactFor(step.recipient) !== undefined || ownWalletFor(step.recipient) !== undefined}
      onSaveAddress={(name) => saveContactMutation.mutate({ address: step.recipient, name })}
      saving={saveContactMutation.isPending}
    />
  );
}

function ComposeStep({
  wallet,
  token,
  balancesQuery,
  arFeeAtomic,
  feeQuote,
  arPrice,
  price,
  currency,
  tokenLogos,
  step,
  showInfo,
  onShowInfo,
  knownName,
  emphasisPick,
  lookalikeOf,
  suggestions,
  onBack,
  onChange,
  onBlurRecipient,
  onBlurAmount,
  onContinue,
  onOpenTokenPicker,
  onOpenSavedAddresses,
  hideSaveOption,
  onToggleSaveAddress,
  onChangeSaveAddressName,
  onConfirmSaveAddress,
  savingAddress,
}: {
  wallet: WalletSummary;
  token: TokenBalance | null;
  balancesQuery: UseQueryResult<WalletBalances>;
  arFeeAtomic: string | undefined;
  /** The recipient's fee, fetched while the user types; Continue reuses it. */
  feeQuote: UseQueryResult<TransferFeeQuote>;
  /** AR's spot price in `currency`, to value the fee. */
  arPrice: number | undefined;
  /** The selected token's spot price in `currency`; `undefined` when unpriced or still loading. */
  price: number | undefined;
  currency: DisplayCurrency | undefined;
  tokenLogos: boolean;
  step: Extract<Step, { kind: "compose" }>;
  /** The Token details view, opened from the ticker in the header's corner. */
  showInfo: boolean;
  onShowInfo: (show: boolean) => void;
  knownName: string | undefined;
  emphasisPick: number | null;
  lookalikeOf: string | null;
  suggestions: NamedAddress[];
  onBack: () => void;
  onChange: (patch: Partial<Extract<Step, { kind: "compose" }>>) => void;
  onBlurRecipient: () => void;
  onBlurAmount: () => void;
  onContinue: () => void;
  onOpenTokenPicker: () => void;
  onOpenSavedAddresses: () => void;
  /** True when the current recipient is already a saved contact or one of your own wallets. */
  hideSaveOption: boolean;
  onToggleSaveAddress: () => void;
  onChangeSaveAddressName: (name: string) => void;
  onConfirmSaveAddress: () => void;
  savingAddress: boolean;
}) {
  const t = useT();
  const denomination = token === null ? 12 : token.denomination;
  const ticker = tickerFor(token);
  // Every non-AR send is an AO data item, which not every wallet kind can sign.
  const unsupported = token === null ? null : capabilityRefusal(wallet.method, "signDataItem", `send ${ticker}`);
  const recipientValid = recipientSchema.safeParse(step.recipient).success;
  const amountValid = amountSchema(denomination).safeParse(step.amountDisplay).success;
  const rawMaxAtomic =
    token === null
      ? balancesQuery.data?.arBalance
      : balancesQuery.data?.tokenBalances.find((candidate) => candidate.processId === token.processId)?.quantity;
  const holdsNone = typeof rawMaxAtomic === "string" && BigInt(rawMaxAtomic) === 0n;
  const typedAtomic = parseDisplayToAtomic(step.amountDisplay, denomination);
  const overBalance =
    typedAtomic === null ? null : validateSendAmount(typedAtomic, token, balancesQuery.data, arFeeAtomic);
  const canContinue =
    !step.submitting && unsupported === null && !holdsNone && recipientValid && amountValid && overBalance === null;
  // A disabled button names what's missing rather than leaving it to guesswork.
  const continueLabel = step.submitting
    ? t("send.estimatingFee")
    : holdsNone
      ? t("send.nothingToSend", { ticker })
      : !recipientValid
      ? t("send.enterAddress")
      : !amountValid
        ? t("send.enterAmount")
        : overBalance !== null
          ? t("send.notEnough", { ticker })
          : t("send.reviewAndSend");
  // For AR, Max is balance minus the rough fee estimate (clamped to 0),
  // hidden until that estimate resolves. This is still an underestimate
  // for a first-seen recipient — `handleContinue`'s post-estimate check
  // is the one that's actually enforced.
  const maxAtomic =
    token === null
      ? rawMaxAtomic !== undefined && arFeeAtomic !== undefined
        ? (BigInt(rawMaxAtomic) > BigInt(arFeeAtomic) ? BigInt(rawMaxAtomic) - BigInt(arFeeAtomic) : 0n).toString()
        : undefined
      : rawMaxAtomic;
  // Every digit: Max goes into the amount, so rounding would leave dust behind, or fill 0 for a tiny balance.
  const maxDisplay = maxAtomic === undefined ? undefined : formatAtomicAsDisplay(maxAtomic, denomination, denomination);
  const balanceDisplay = rawMaxAtomic === undefined ? undefined : formatAtomicCompact(rawMaxAtomic, denomination);
  const amountNumber = Number(step.amountDisplay);
  // Display only: the value line is an estimate, so a float is fine here.
  // Priced in the token being sent, it would only repeat the amount.
  const fiatDisplay =
    price !== undefined &&
    currency !== undefined &&
    currency !== ticker &&
    step.amountDisplay.length > 0 &&
    Number.isFinite(amountNumber)
      ? formatCurrencyValue(amountNumber * price, currency)
      : undefined;
  const balanceNumber = rawMaxAtomic === undefined ? Number.NaN : Number(formatAtomicAsDisplay(rawMaxAtomic, denomination, denomination));
  const balanceValue =
    price !== undefined && currency !== undefined && currency !== ticker && balanceDisplay !== undefined && Number.isFinite(balanceNumber)
      ? formatCurrencyValue(balanceNumber * price, currency)
      : undefined;
  const feeAtomic = feeQuote.data?.fee ?? null;
  const feeFiat = feeFiatText(feeAtomic, {
    currency,
    prices: arPrice === undefined ? undefined : [{ processId: null, price: arPrice, change24h: null }],
  });
  const identity = useAddressIdentity();

  if (showInfo) {
    return (
      <div className="flex min-h-full flex-col">
        <ScreenHeader title={t("send.tokenDetails")} onBack={() => onShowInfo(false)} />
        <div className="px-6 py-5 phone:px-5">
          <TokenInfoPanel
            token={token}
            logoUrl={sendTokenLogo(token, readRowVisibility(wallet.address), tokenLogos)}
            balanceDisplay={balanceDisplay}
            balanceValue={balanceValue}
            priceDisplay={price !== undefined && currency !== undefined && currency !== ticker ? formatCurrencyValue(price, currency) : undefined}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader
        title={t("send.sendTab")}
        onBack={onBack}
        end={
          <button
            type="button"
            aria-label={t("send.tokenDetails")}
            onClick={() => onShowInfo(true)}
            className="flex max-w-[104px] flex-shrink-0 items-center gap-1 rounded-md px-1 py-1 text-label font-normal text-muted hover:text-foreground phone:hit-target focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground"
          >
            <span className="truncate">{ticker}</span>
            <InfoIcon />
          </button>
        }
      />
      <div className="flex flex-1 flex-col gap-6 px-6 py-5 phone:px-5 phone:pb-0">
        <div className="flex items-center justify-between gap-3 text-label">
          <span className="font-semibold text-muted">{t("send.from")}</span>
          <span className="flex min-w-0 items-center gap-2">
            <AccountAvatar svgMarkup={identity.avatarSvg(wallet.address)} label={t("send.avatarLabel", { name: wallet.name })} size={20} />
            <span className="truncate font-semibold text-foreground">{wallet.name}</span>
            <span className="flex-shrink-0 font-mono text-caption text-faint">{truncateAddress(wallet.address, 6)}</span>
          </span>
        </div>

        <RecipientField
          recipient={step.recipient}
          recipientError={step.recipientError}
          knownName={knownName}
          emphasisPick={emphasisPick}
          lookalikeOf={lookalikeOf}
          suggestions={suggestions}
          onChangeRecipient={(recipient) => onChange({ recipient })}
          onBlurRecipient={onBlurRecipient}
          onOpenSavedAddresses={onOpenSavedAddresses}
          hideSaveOption={hideSaveOption}
          showSaveAddress={step.showSaveAddress}
          saveAddressName={step.saveAddressName}
          onToggleSaveAddress={onToggleSaveAddress}
          onChangeSaveAddressName={onChangeSaveAddressName}
          onConfirmSaveAddress={onConfirmSaveAddress}
          savingAddress={savingAddress}
        />

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-label font-semibold text-muted">{t("send.amount")}</span>
            <span className="flex items-center gap-1 text-label">
              {balanceDisplay !== undefined ? (
                <span className="tabular-nums text-muted">
                  {t("send.balance", { amount: `${balanceDisplay} ${ticker}` })}
                </span>
              ) : null}
              {maxDisplay !== undefined && !holdsNone ? (
                <button
                  type="button"
                  aria-label={t("send.maxAria", { amount: maxDisplay })}
                  onClick={() => onChange({ amountDisplay: maxDisplay })}
                  className="rounded-full px-2 py-1 text-caption font-semibold uppercase tracking-wide text-foreground hover:bg-mist phone:hit-target"
                >
                  {t("send.max")}
                </button>
              ) : null}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 border-0 border-b border-line bg-transparent px-0 py-3.5">
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                aria-label={t("send.amount")}
                placeholder="0"
                value={step.amountDisplay}
                onChange={(event) => {
                  onChange({ amountDisplay: sanitizeAmountInput(event.target.value) });
                }}
                onBlur={onBlurAmount}
                className="min-w-0 flex-1 border-none bg-transparent text-display-sm font-semibold tracking-[-0.01em] tabular-nums text-foreground placeholder:text-faint focus:outline-none"
              />
              <button
                type="button"
                onClick={onOpenTokenPicker}
                aria-haspopup="dialog"
                className="flex flex-shrink-0 items-center gap-1.5 rounded-[7px] border border-line bg-mist py-1.5 pl-1.5 pr-2.5 text-label font-bold text-foreground hover:bg-line phone:hit-target"
              >
                <TokenGlyph
                  label={ticker.slice(0, 2).toUpperCase()}
                  tone={token === null ? 1 : 2}
                  logoUrl={sendTokenLogo(token, readRowVisibility(wallet.address), tokenLogos)}
                  className="h-5 w-5 rounded-md text-micro"
                />
                {ticker}
                <ChevronDownIcon />
              </button>
            </div>
            {fiatDisplay !== undefined ? (
              <span className="text-caption tabular-nums text-muted">≈ {fiatDisplay}</span>
            ) : null}
          </div>
          {step.amountError ? (
            <div role="alert" className="text-label leading-snug text-warning">
              {step.amountError}
            </div>
          ) : null}
          {amountValid && recipientValid ? <NetworkFeeLine quote={feeQuote} fiat={feeFiat} /> : null}
        </div>

        {unsupported ? (
          <p role="status" className="rounded-md border border-l-[3px] border-line border-l-warning bg-mist px-3.5 py-3 text-label leading-snug text-foreground">
            {errorText(unsupported)}
          </p>
        ) : null}

        <ScreenFooter>
          <Button type="button" disabled={!canContinue} aria-busy={step.submitting} onClick={onContinue}>
            {continueLabel}
          </Button>
        </ScreenFooter>
      </div>
    </div>
  );
}

/**
 * The fee on compose, fetched while the user types. A failed quote shows
 * nothing here: Continue fetches it again and shows the error.
 */
export function NetworkFeeLine({ quote, fiat }: { quote: UseQueryResult<TransferFeeQuote>; fiat?: string }) {
  const t = useT();
  if (quote.isError) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 text-label">
      <span className="text-muted">{t("transferReview.networkFee")}</span>
      {quote.data === undefined ? (
        <span className="text-muted">{t("send.estimatingFee")}</span>
      ) : (
        <span className="tabular-nums text-foreground">
          {feeText(quote.data.fee, t)}
          {fiat !== undefined ? <span className="ml-1.5 text-muted">{fiat}</span> : null}
        </span>
      )}
    </div>
  );
}

/**
 * The "To" field: address input and the quiet "Save this address" line.
 * While the input has focus, a short list of named addresses drops down
 * under it, filtered by what's typed, ending in a "Saved contacts" link to
 * the full picker. Once a valid address loses focus, the input
 * gives way to a card with the address's avatar and chunked form, so it
 * can be checked at a glance before Review send. "Change" brings the
 * input back.
 */
export function RecipientField({
  recipient,
  recipientError,
  knownName,
  emphasisPick,
  lookalikeOf,
  suggestions,
  onChangeRecipient,
  onBlurRecipient,
  onOpenSavedAddresses,
  hideSaveOption,
  showSaveAddress,
  saveAddressName,
  onToggleSaveAddress,
  onChangeSaveAddressName,
  onConfirmSaveAddress,
  savingAddress,
}: {
  recipient: string;
  recipientError: string | undefined;
  /** The saved contact's or own wallet's name for `recipient`, if it is one. */
  knownName: string | undefined;
  emphasisPick: number | null;
  /** A trusted address this one imitates, warned about while still composing. */
  lookalikeOf: string | null;
  /** Named addresses for the focus dropdown, most recently sent to first (`namedSuggestions`). */
  suggestions: NamedAddress[];
  onChangeRecipient: (recipient: string) => void;
  onBlurRecipient: () => void;
  onOpenSavedAddresses: () => void;
  /** True when the current recipient is already a saved contact or one of your own wallets. */
  hideSaveOption: boolean;
  showSaveAddress: boolean;
  saveAddressName: string;
  onToggleSaveAddress: () => void;
  onChangeSaveAddressName: (name: string) => void;
  onConfirmSaveAddress: () => void;
  savingAddress: boolean;
}) {
  const t = useT();
  const { capabilities, qrScanner } = usePlatform();
  const [editing, setEditing] = useState<"no" | "focused" | "refocus">("no");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | undefined>();
  // A scan fills the field without focusing it, so no blur will validate it.
  const [validateScan, setValidateScan] = useState(false);
  useEffect(() => {
    if (!validateScan) return;
    setValidateScan(false);
    onBlurRecipient();
  }, [validateScan, onBlurRecipient]);
  const address = recipientSchema.safeParse(recipient).data;
  const identity = useAddressIdentity();
  const avatarSvg = address ? identity.avatarSvg(address) : undefined;
  const showCard = editing === "no" && !recipientError && address !== undefined && avatarSvg !== undefined;
  // Picking a row swaps the input for the card; a blur fired on the way
  // out still carries the old text and would flag it as invalid.
  const pickedRef = useRef(false);
  const query = recipient.trim().toLowerCase();
  // Also the only way into the full picker, so it opens even with nothing to suggest.
  const showDropdown = editing === "focused" && address === undefined;
  const shownSuggestions = showDropdown
    ? suggestions
        .filter(
          (candidate) =>
            query.length === 0 || candidate.name.toLowerCase().includes(query) || candidate.address.toLowerCase().includes(query),
        )
        .slice(0, SUGGESTION_LIMIT)
    : [];

  async function scan() {
    setScanning(true);
    setScanError(undefined);
    try {
      const payload = await qrScanner.scan();
      if (payload === null) return;
      onChangeRecipient(addressFromQr(payload));
      setValidateScan(true);
    } catch (error) {
      setScanError(
        error instanceof QrScanError && error.reason === "permission-denied"
          ? t("send.scanCameraOff")
          : t("send.scanFailed"),
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-label font-semibold text-muted">{t("send.to")}</span>
        {capabilities.qrScanner ? (
          <button
            type="button"
            aria-label={t("send.scanQr")}
            disabled={scanning}
            onClick={() => void scan()}
            // 44px target without growing the label row.
            className="-my-3 -mr-3 flex h-11 w-11 items-center justify-center rounded-md text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground disabled:opacity-50"
          >
            <QrScanIcon />
          </button>
        ) : null}
      </div>
      {showCard ? (
        <RecipientCard
          address={address}
          name={knownName ?? null}
          avatarSvg={avatarSvg}
          emphasisPick={emphasisPick}
          diffAgainst={lookalikeOf ?? undefined}
          onEdit={() => setEditing("refocus")}
        />
      ) : (
        <div className="relative">
          <input
            type="text"
            spellCheck={false}
            aria-label={t("send.recipientAddress")}
            autoFocus={editing === "refocus"}
            value={recipient}
            onChange={(event) => onChangeRecipient(event.target.value)}
            onFocus={() => {
              pickedRef.current = false;
              setEditing("focused");
            }}
            onBlur={() => {
              setEditing("no");
              if (!pickedRef.current) onBlurRecipient();
            }}
            placeholder={t("send.pasteAddress")}
            className="w-full border-0 border-b border-line bg-transparent px-0 py-3 font-mono text-label leading-relaxed text-foreground focus:outline-none"
          />
          {showDropdown ? (
            <div
              role="listbox"
              aria-label={t("send.savedContacts")}
              // Keeps focus in the input, so a click lands before the blur closes the list.
              onMouseDown={(event) => event.preventDefault()}
              className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.10),0_1px_3px_rgba(0,0,0,0.06)]"
            >
              {shownSuggestions.length > 0 ? (
                <div className="py-1">
                  {shownSuggestions.map((candidate) => (
                    <AddressRow
                      key={candidate.address}
                      address={candidate.address}
                      name={candidate.name}
                      onSelect={() => {
                        pickedRef.current = true;
                        onChangeRecipient(candidate.address);
                        setEditing("no");
                      }}
                    />
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={onOpenSavedAddresses}
                className="flex w-full items-center justify-between px-3.5 py-3 text-left text-label font-medium text-muted hover:bg-mist hover:text-foreground"
              >
                {t("send.savedContacts")}
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
      )}
      {recipientError ? (
        <div role="alert" className="text-label leading-snug text-warning">
          {recipientError}
        </div>
      ) : null}
      {scanError ? (
        <div role="alert" className="text-label leading-snug text-warning">
          {scanError}
        </div>
      ) : null}
      {lookalikeOf ? (
        <RecipientWarning
          firstTime={false}
          recipient={recipient}
          lookalikeOf={lookalikeOf}
          lookalikeAvatarSvg={identity.avatarSvg(lookalikeOf)}
          emphasisPick={emphasisPick}
        />
      ) : null}
      {/* Saving a lookalike would make the fake a trusted contact. */}
      {!recipientError && !lookalikeOf && recipientSchema.safeParse(recipient).success && !hideSaveOption ? (
        <SaveAddressInline
          expanded={showSaveAddress}
          name={saveAddressName}
          saving={savingAddress}
          onToggle={onToggleSaveAddress}
          onChangeName={onChangeSaveAddressName}
          onConfirm={onConfirmSaveAddress}
        />
      ) : null}
    </div>
  );
}

export function QrScanIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <rect x="8" y="8" width="3" height="3" />
      <rect x="13" y="13" width="3" height="3" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The quiet "Save this address" affordance under the recipient field
 * (compose) and under the success message (`SuccessStep`) — one checkbox
 * that reveals a blank name input in place, no modal. Shown only for a
 * full, valid, not-yet-saved address (callers gate on `contact`/`isSaved`
 * before rendering this).
 */
function SaveAddressInline({
  expanded,
  name,
  saving,
  onToggle,
  onChangeName,
  onConfirm,
}: {
  expanded: boolean;
  name: string;
  saving: boolean;
  onToggle: () => void;
  onChangeName: (name: string) => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      {/* Keeps focus in the recipient input: its blur swaps in the shorter card, which moves this checkbox out from under the click. */}
      <label onMouseDown={(event) => event.preventDefault()} className="flex w-fit items-center gap-2 text-label text-muted phone:min-h-11 phone:gap-2.5">
        <input type="checkbox" checked={expanded} onChange={onToggle} className="h-3.5 w-3.5 accent-foreground phone:h-5 phone:w-5" />
        {t("send.saveThisAddress")}
      </label>
      {expanded ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(event) => onChangeName(event.target.value.slice(0, 32))}
            onKeyDown={(event) => {
              if (event.key === "Enter") onConfirm();
            }}
            placeholder={t("send.enterAddressName")}
            className="min-w-0 flex-1 border-0 border-b border-line bg-transparent px-0 py-2.5 text-label text-foreground focus:outline-none"
          />
          <button
            type="button"
            disabled={name.trim().length === 0 || saving}
            onClick={onConfirm}
            className="flex-shrink-0 text-label font-semibold text-foreground underline-offset-2 hover:underline disabled:opacity-40"
          >
            {saving ? t("send.saving") : t("send.save")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ReviewStep({
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
              onSecondary={onBack}
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
        <div role="alert" className="text-label leading-snug text-warning">
          {step.error}
        </div>
      ) : null}
      {step.submitting && signsOnDevice ? (
        <p role="status" className="text-label leading-snug text-muted">
          {t("send.approveOnDevice")}
        </p>
      ) : null}
    </TransferReview>
  );
}

export function ReviewRow({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 text-label last:border-b-0 phone:border-b-0 phone:py-3">
      <span className="text-muted">{label}</span>
      <span
        className={`text-right tabular-nums text-foreground ${strong ? "font-bold" : "font-semibold"} ${mono ? "max-w-[220px] break-all font-mono text-caption font-medium" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Synthetic `TokenBalance` for the AO default row when `balancesQuery.data`
 * has no matching AO entry yet (unloaded, or a wallet that genuinely holds
 * none). Gives the row a real, selectable `token: null`-equivalent — every
 * row here must stay clickable, so a `div`-only "coming soon" row (what
 * `TokenRow` renders when `onClick` is `undefined`) isn't an option.
 * `address` mirrors the connected wallet since nothing downstream of
 * `selectedToken` reads anything but `processId`/`ticker`/`denomination`/
 * `quantity` (see `handleContinue`/`handleSign` above).
 */
function defaultAoTokenBalance(walletAddress: string): TokenBalance {
  return {
    address: walletAddress,
    processId: DEFAULT_AO_TOKEN.processId as string,
    ticker: DEFAULT_AO_TOKEN.ticker,
    denomination: 0,
    name: DEFAULT_AO_TOKEN.name,
    quantity: "0",
  };
}

/**
 * Token picker — a pushed screen (`WalletSwitcherView.tsx`'s established
 * "ScreenHeader + rows" pattern, not a dropdown/modal). AR and AO are
 * synthetic default rows (mirroring `MainScreenView`'s Tokens tab — see
 * `buildDefaultTokenRows`/`nonDefaultTokenBalances` there): AR is
 * `token: null`, and AO is always rendered above any other watched AO
 * tokens, falling back to `DEFAULT_AR_TOKEN`/`DEFAULT_AO_TOKEN`'s `"0"`
 * `defaultDisplayAmount` while `balancesQuery.data` is unloaded or has no
 * AO entry, and updating to the real balance once it resolves. Every row
 * is genuinely selectable — there is no disabled/"coming soon" state.
 */
function TokenPickerStep({
  walletAddress,
  balancesQuery,
  tokenLogos,
  selectedToken,
  onSelect,
  onBack,
}: {
  walletAddress: string;
  balancesQuery: UseQueryResult<WalletBalances>;
  tokenLogos: boolean;
  selectedToken: TokenBalance | null;
  onSelect: (token: TokenBalance | null) => void;
  onBack: () => void;
}) {
  const t = useT();
  const loading = balancesQuery.isLoading;
  const errorMessage = balancesQuery.error ? errorText(balancesQuery.error) : null;

  const aoBalance = balancesQuery.data?.tokenBalances.find(
    (candidate) => candidate.processId === DEFAULT_AO_TOKEN.processId,
  );
  const aoToken = aoBalance ?? defaultAoTokenBalance(walletAddress);
  const visibility = readRowVisibility(walletAddress);
  const otherTokenBalances = (balancesQuery.data?.tokenBalances ?? []).filter(
    (candidate) =>
      candidate.processId !== DEFAULT_AO_TOKEN.processId &&
      (candidate.processId === selectedToken?.processId || !isTokenHidden(candidate, visibility)),
  );

  return (
    <div className="flex min-h-full flex-col" role="dialog" aria-label={t("send.selectToken")}>
      <ScreenHeader title={t("send.selectToken")} onBack={onBack} />
      <div className="flex flex-1 flex-col px-1 py-2 phone:px-5">
        {errorMessage ? (
          <div role="alert" className="px-4 py-3 text-label leading-snug text-warning phone:px-0">
            {errorMessage}
          </div>
        ) : null}

        <TokenRow
          glyph={{ label: DEFAULT_AR_TOKEN.ticker, tone: 1, logoUrl: sendTokenLogo(null, visibility, tokenLogos) }}
          name={DEFAULT_AR_TOKEN.name}
          amount={
            balancesQuery.data === undefined
              ? DEFAULT_AR_TOKEN.defaultDisplayAmount
              : formatAtomicCompact(balancesQuery.data.arBalance, 12)
          }
          loading={loading}
          onClick={() => onSelect(null)}
          className={selectedToken === null ? "bg-mist" : undefined}
        />

        <TokenRow
          glyph={{ label: DEFAULT_AO_TOKEN.ticker, tone: 2, logoUrl: sendTokenLogo(aoToken, visibility, tokenLogos) }}
          name={DEFAULT_AO_TOKEN.name}
          amount={
            aoBalance
              ? aoBalance.available === false
                ? unavailableTokenBalanceLabel()
                : formatAtomicCompact(aoBalance.quantity, aoBalance.denomination)
              : DEFAULT_AO_TOKEN.defaultDisplayAmount
          }
          loading={loading}
          onClick={aoBalance?.available === false ? undefined : () => onSelect(aoToken)}
          className={selectedToken?.processId === DEFAULT_AO_TOKEN.processId ? "bg-mist" : undefined}
        />

        {loading ? (
          <>
            <SkeletonPickerRow />
            <SkeletonPickerRow />
          </>
        ) : (
          otherTokenBalances.map((candidate) => (
            <TokenRow
              key={candidate.processId}
              glyph={{ label: displayTicker(candidate.ticker).slice(0, 2).toUpperCase(), tone: 2, logoUrl: shownTokenLogo(candidate, visibility, tokenLogos) }}
              name={displayTicker(candidate.ticker)}
              amount={
                candidate.available === false
                  ? unavailableTokenBalanceLabel()
                  : formatAtomicCompact(candidate.quantity, candidate.denomination)
              }
              onClick={candidate.available === false ? undefined : () => onSelect(candidate)}
              className={selectedToken?.processId === candidate.processId ? "bg-mist" : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SkeletonPickerRow() {
  return (
    <div className="flex w-full items-center gap-2.5 border-b border-line px-3.5 py-3 last:border-b-0 phone:border-b-0 phone:px-0">
      <div className="h-8 w-8 flex-shrink-0 animate-pulse rounded-full bg-mist" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="h-3 w-20 animate-pulse rounded bg-mist" />
        <div className="h-2.5 w-10 animate-pulse rounded bg-mist" />
      </div>
    </div>
  );
}

/**
 * Saved contacts picker, in three sections: saved contacts (`useContacts`,
 * vault-wide), "Your wallets" (`useOtherWallets`, never the active one),
 * then the latest few addresses sent to that have no
 * name. Each section skips addresses an earlier one already shows. The
 * search field filters every section by name or address, and searches
 * every recent address rather than just the few listed. Rows show the
 * same identicon as everywhere else an address appears.
 */
export function SavedAddressesStep({
  runtime,
  wallet,
  contacts,
  contactsLoading,
  otherWallets,
  otherWalletsLoading,
  onSelect,
  onEditContacts,
  onBack,
}: {
  runtime: RuntimePort;
  wallet: WalletSummary;
  contacts: Contact[];
  contactsLoading: boolean;
  otherWallets: WalletSummary[];
  otherWalletsLoading: boolean;
  onSelect: (recipient: string) => void;
  /** Opens the contact list to add, rename or delete; omitted where the picker can't host it. */
  onEditContacts?: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState("");
  const activityQuery = useActivity(runtime, wallet.address);

  const shownAddresses = new Set([...contacts.map((c) => c.address), ...otherWallets.map((w) => w.address)]);
  const recentOnly = activityQuery.data
    ? recentSendRecipients(activityQuery.data).filter((address) => !shownAddresses.has(address))
    : [];

  const query = filter.trim().toLowerCase();
  const matches = (name: string | null, address: string) =>
    query.length === 0 || (name?.toLowerCase().includes(query) ?? false) || address.toLowerCase().includes(query);

  const filteredContacts = contacts.filter((contact) => matches(contact.name, contact.address));
  const filteredWallets = otherWallets.filter((candidate) => matches(candidate.name, candidate.address));
  const filteredRecent = recentOnly
    .filter((address) => matches(null, address))
    .slice(0, query.length > 0 ? undefined : RECENT_LIMIT);

  const loading = contactsLoading || otherWalletsLoading || activityQuery.isLoading;
  const isEmpty =
    !loading && filteredContacts.length === 0 && filteredWallets.length === 0 && filteredRecent.length === 0;

  return (
    <div className="flex min-h-full flex-col" role="dialog" aria-label={t("send.savedContacts")}>
      <ScreenHeader
        title={t("send.savedContacts")}
        onBack={onBack}
        end={
          onEditContacts ? (
            <button
              type="button"
              aria-label={t("send.editContacts")}
              onClick={onEditContacts}
              className="rounded-md px-2 py-1 text-label font-semibold text-muted hover:bg-mist hover:text-foreground phone:hit-target"
            >
              {t("send.edit")}
            </button>
          ) : undefined
        }
      />
      <SearchField
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={t("send.searchPlaceholder")}
        className="px-[18px] pb-1 pt-3 phone:px-5"
      />
      <div className="flex flex-1 flex-col px-1 py-2 phone:px-5">
        {activityQuery.isError ? (
          <div role="alert" className="px-4 py-3 text-label leading-snug text-warning phone:px-0">
            {errorText(activityQuery.error)}
          </div>
        ) : loading ? (
          <>
            <SkeletonPickerRow />
            <SkeletonPickerRow />
          </>
        ) : isEmpty ? (
          <EmptyState
            message={
              query.length > 0
                ? t("send.noMatching")
                : t("send.noSavedYet")
            }
          />
        ) : (
          <>
            {filteredContacts.length > 0 ? (
              <PickerSection label={t("send.contacts")}>
                {filteredContacts.map((contact) => (
                  <AddressRow key={contact.address} address={contact.address} name={contact.name} onSelect={() => onSelect(contact.address)} />
                ))}
              </PickerSection>
            ) : null}
            {filteredWallets.length > 0 ? (
              <PickerSection label={t("send.yourWallets")}>
                {filteredWallets.map((candidate) => (
                  <AddressRow key={candidate.address} address={candidate.address} name={candidate.name} onSelect={() => onSelect(candidate.address)} />
                ))}
              </PickerSection>
            ) : null}
            {filteredRecent.length > 0 ? (
              <PickerSection label={t("send.recent")}>
                {filteredRecent.map((address) => (
                  <AddressRow key={address} address={address} name={null} onSelect={() => onSelect(address)} />
                ))}
              </PickerSection>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function PickerSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <div className="px-3.5 pb-1.5 pt-3 text-caption font-semibold uppercase tracking-wide text-muted phone:px-0">{label}</div>
      {children}
    </section>
  );
}

export interface NamedAddress {
  address: string;
  name: string;
}

const SUGGESTION_LIMIT = 4;

/**
 * Saved contacts and the vault's other wallets, for the recipient field's
 * dropdown, ordered by how recently each was sent to; never-sent-to ones
 * keep their list order at the end. A contact wins over a wallet with the
 * same address.
 */
export function namedSuggestions(
  contacts: Contact[],
  otherWallets: WalletSummary[],
  activity: ActivityPage | undefined,
): NamedAddress[] {
  const contactAddresses = new Set(contacts.map((contact) => contact.address));
  const named: NamedAddress[] = [
    ...contacts.map(({ address, name }) => ({ address, name })),
    ...otherWallets.filter((candidate) => !contactAddresses.has(candidate.address)).map(({ address, name }) => ({ address, name })),
  ];
  const recency = activity ? recentSendRecipients(activity) : [];
  const rank = (address: string) => {
    const index = recency.indexOf(address);
    return index === -1 ? recency.length : index;
  };
  return named.sort((a, b) => rank(a.address) - rank(b.address));
}

/** Older recipients are a search away; the list itself stays short. */
const RECENT_LIMIT = 5;

/**
 * Pure extraction — separated from `RecentRecipientsStep` so it's testable
 * without mounting the component. `mergeActivity` (`core/activity/merge.ts`)
 * already returns entries most-recent-first (its own doc contract), so
 * this only needs to filter/map/dedupe, not re-sort — but sorts
 * defensively by `timestamp` descending anyway rather than assuming the
 * caller's ordering contract silently holds forever.
 */
function recentSendRecipients(activity: ActivityPage): string[] {
  const sendEntries = activity.entries
    .filter((entry) => entry.type === "send")
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);

  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const entry of sendEntries) {
    if (seen.has(entry.address)) continue;
    seen.add(entry.address);
    recipients.push(entry.address);
  }
  return recipients;
}

/** "Signed and sent." with what was sent, the explorer link and "Save as contact". */
export function SuccessStep({
  summary,
  txId,
  onDone,
  isSaved,
  onSaveAddress,
  saving,
}: {
  /** What went where, e.g. "1 AR to <address>". */
  summary: string;
  txId: string;
  onDone: () => void;
  /** Whether `step.recipient` is already a saved contact — hides "Save as contact" when true. */
  isSaved: boolean;
  onSaveAddress: (name: string) => void;
  saving: boolean;
}) {
  const t = useT();
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex min-h-full flex-col items-center gap-4 px-6 phone:px-5 pb-6 pt-12 text-center">
      <div className="mb-1 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-mist text-foreground">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="text-body text-foreground">{t("send.signedAndSent")}</h2>
      <p className="-mt-2 break-words text-label text-muted">{summary}</p>
      <div className="mt-2 flex w-full items-center gap-2 border-b border-line py-3 text-label text-muted phone:border-b-0">
        <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-beam-yellow" />
        <span>{t("send.pendingConfirmation")}</span>
      </div>
      <a
        href={explorerUrlFor(txId)}
        target="_blank"
        rel="noopener noreferrer"
        className="-mt-1 text-label font-semibold text-muted underline-offset-2 hover:text-foreground hover:underline"
      >
        {t("send.viewInExplorer")}
      </a>

      {!isSaved && !saved ? (
        <div className="w-full text-left">
          {showSave ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, 32))}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || name.trim().length === 0) return;
                  onSaveAddress(name.trim());
                  setSaved(true);
                }}
                placeholder={t("send.enterAddressName")}
                className="min-w-0 flex-1 border-0 border-b border-line bg-transparent px-0 py-2.5 text-label text-foreground focus:outline-none"
              />
              <button
                type="button"
                disabled={name.trim().length === 0 || saving}
                onClick={() => {
                  onSaveAddress(name.trim());
                  setSaved(true);
                }}
                className="flex-shrink-0 text-label font-semibold text-foreground underline-offset-2 hover:underline disabled:opacity-40"
              >
                {saving ? t("send.saving") : t("send.save")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSave(true)}
              className="text-label font-medium text-muted hover:text-foreground hover:underline"
            >
              {t("send.saveAsContact")}
            </button>
          )}
        </div>
      ) : null}

      <ScreenFooter>
        <Button type="button" onClick={onDone}>
          {t("send.done")}
        </Button>
      </ScreenFooter>
    </div>
  );
}

function InfoIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6v.01" strokeWidth="2.6" />
    </svg>
  );
}
