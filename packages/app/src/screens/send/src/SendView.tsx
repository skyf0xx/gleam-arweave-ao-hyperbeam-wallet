import { useEffect, useRef, useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { capabilityRefusal, explorerUrlFor, isHardwareWalletMethod, type ActivityPage, type Contact, type DisplayCurrency, type FeeEstimate, type RuntimePort, type TokenBalance, type TokenPrice, type WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { AccountAvatar, EmptyState, RecipientCard, RecipientWarning, TokenRow } from "@gleam/ui/src/components/wallet/index.ts";
import { formatCurrencyValue } from "@gleam/ui/src/format/currency.ts";
import { useAddressIdentity } from "../../../address-identity";
import { usePlatform } from "../../../app-platform/context";
import { addressFromQr, QrScanError } from "../../../app-platform/qr-scanner";
import { useDisplaySettings } from "../../../display-settings";
import { DEFAULT_AO_TOKEN, DEFAULT_AR_TOKEN } from "@gleam/ui";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { displayTicker, formatAtomicAsDisplay, formatWinstonAsAr } from "../../main-screen/src/formatWinston";
import { useTokenPrices } from "../../main-screen/src/useTokenPrices";
import { AddressRow } from "../../activity/src/AddressRow";
import { useActivity } from "../../activity/src/useActivity";
import { useArFee } from "../../activity/src/useArFee";
import { useBalances, type WalletBalances } from "../../activity/src/useBalances";
import { useContacts, useSaveContact } from "../../activity/src/useContacts";
import { useOtherWallets } from "../../activity/src/useOtherWallets";
import { useSubmitTransfer } from "../../activity/src/useSubmitTransfer";
import { validateSendAmount } from "../../activity/src/validateSendAmount";
import { amountSchema, firstIssueMessage, recipientSchema } from "./sendFormSchema";
import { TokenInfoPanel } from "./TokenInfoPanel";
import { useLookalikeOf } from "./useLookalikeOf";
import { readRowVisibility, shownTokenLogo } from "../../../token-visibility";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";

const WINSTON_PER_AR = 1_000_000_000_000n;

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
  | {
      kind: "review";
      recipient: string;
      amountAtomic: string;
      estimate: FeeEstimate;
      submitting: boolean;
      error?: string;
    }
  | { kind: "success"; txId: string; recipient: string; amountAtomic: string };

function parseArToWinston(amountAr: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(amountAr.trim())) return null;
  const [wholePart, fractionPart = ""] = amountAr.trim().split(".");
  const fraction = fractionPart.padEnd(12, "0").slice(0, 12);
  const winston = BigInt(wholePart || "0") * WINSTON_PER_AR + BigInt(fraction || "0");
  return winston.toString();
}

/**
 * Parses a human-entered display amount into an atomic-integer string in
 * `denomination`'s smallest unit (matching `TokenBalance.quantity`'s own
 * shape) — the AO-token equivalent of `parseArToWinston` above, generalized
 * over an arbitrary decimal-places `denomination` instead of AR's fixed 12.
 * `BigInt` throughout; no amount ever passes through a floating-point
 * `Number` conversion.
 */
function parseDisplayToAtomic(amountDisplay: string, denomination: number): string | null {
  if (!/^\d+(\.\d+)?$/.test(amountDisplay.trim())) return null;
  const [wholePart, fractionPart = ""] = amountDisplay.trim().split(".");
  const fraction = fractionPart.padEnd(denomination, "0").slice(0, denomination);
  const atomic = BigInt(wholePart || "0") * 10n ** BigInt(denomination) + BigInt(fraction || "0");
  return atomic.toString();
}

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
const UNAVAILABLE_TOKEN_BALANCE_LABEL = "Unavailable";

/** `token.ticker` for an AO token, `"AR"` for the native token (`token === null`). */
function tickerFor(token: TokenBalance | null): string {
  return token === null ? "AR" : displayTicker(token.ticker);
}

function formatAmount(atomic: string, token: TokenBalance | null): string {
  return token === null ? formatWinstonAsAr(atomic) : formatAtomicAsDisplay(atomic, token.denomination);
}

/** `TokenPrice.price` is `null` for a token that couldn't be priced; that reads as no price here. */
function priceFor(prices: TokenPrice[] | undefined, token: TokenBalance | null): number | undefined {
  const price = prices?.find((entry) => entry.processId === (token === null ? null : token.processId))?.price;
  return typeof price === "number" ? price : undefined;
}

export function SendView({ runtime, wallet, token, onBack, onDone }: SendViewProps) {
  const [step, setStep] = useState<Step>(INITIAL_STEP);
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
  const showTokenLogos = displaySettings?.showTokenLogos ?? false;
  const tokenPricesQuery = useTokenPrices(runtime, currency);
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
          recipientError: firstIssueMessage(recipientResult.error, "That doesn't look like a valid address."),
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
          amountError: firstIssueMessage(amountResult.error, "Enter a valid amount."),
        });
        return;
      }
      const amountAtomic =
        selectedToken === null
          ? parseArToWinston(amountResult.data)
          : parseDisplayToAtomic(amountResult.data, selectedToken.denomination);
      if (amountAtomic === null) {
        setStep({ ...step, recipientError: undefined, amountError: "Enter a valid amount." });
        return;
      }

      const balanceError = validateSendAmount(amountAtomic, selectedToken, balancesQuery.data, arFeeQuery.data);
      if (balanceError !== null) {
        setStep({ ...step, recipientError: undefined, amountError: balanceError });
        return;
      }

      setStep({ ...step, submitting: true, recipientError: undefined, amountError: undefined });
      try {
        const estimate = await runtime.send<
          { walletId: string; recipient: string; token: string | null; amount: string; fee: null },
          FeeEstimate
        >({
          type: "estimateTransfer",
          payload: {
            walletId: wallet.id,
            recipient,
            token: selectedToken === null ? null : selectedToken.processId,
            amount: amountAtomic,
            fee: null,
          },
        });

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
          estimate,
          submitting: false,
        });
      } catch (error) {
        setStep({
          ...step,
          submitting: false,
          amountError: error instanceof Error ? error.message : String(error),
        });
      }
    };

    return (
      <ComposeStep
        wallet={wallet}
        token={selectedToken}
        balancesQuery={balancesQuery}
        arFeeAtomic={arFeeQuery.data}
        price={priceFor(tokenPricesQuery.data, selectedToken)}
        currency={currency}
        showTokenLogos={showTokenLogos}
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
              : firstIssueMessage(result.error, "That doesn't look like a valid address."),
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
            amountError: result.success ? undefined : firstIssueMessage(result.error, "Enter a valid amount."),
          });
        }}
        onContinue={() => void handleContinue()}
        onOpenTokenPicker={() => {
          setSavedComposeStep(step);
          setStep({ kind: "token-picker" });
        }}
        onOpenSavedAddresses={() => setStep({ kind: "saved-addresses" })}
      />
    );
  }

  if (step.kind === "token-picker") {
    return (
      <TokenPickerStep
        walletAddress={wallet.address}
        balancesQuery={balancesQuery}
        showTokenLogos={showTokenLogos}
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
        onSelect={(recipient) => setStep({ ...INITIAL_STEP, recipient })}
        onBack={() => setStep(INITIAL_STEP)}
      />
    );
  }

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
        setStep({ ...step, submitting: false, error: error instanceof Error ? error.message : String(error) });
      }
    };

    return (
      <ReviewStep
        token={selectedToken}
        step={step}
        contact={contactFor(step.recipient)}
        ownWallet={ownWalletFor(step.recipient)}
        emphasisPick={emphasisPick}
        signsOnDevice={isHardwareWalletMethod(wallet.method)}
        onBack={() => setStep({ ...INITIAL_STEP, recipient: step.recipient })}
        onSign={() => void handleSign()}
      />
    );
  }

  return (
    <SuccessStep
      summary={`${formatAmount(step.amountAtomic, selectedToken)} ${tickerFor(selectedToken)} to ${step.recipient}`}
      txId={step.txId}
      onDone={onDone}
      isSaved={contactFor(step.recipient) !== undefined || ownWalletFor(step.recipient) !== undefined}
      onSaveAddress={(name) => saveContactMutation.mutate({ address: step.recipient, name })}
      saving={saveContactMutation.isPending}
    />
  );
}

/** What you can do with the token, shown as tabs in the compose header. */
const TOKEN_ACTIONS = [{ id: "send", label: "Send" }] as const;

function ComposeStep({
  wallet,
  token,
  balancesQuery,
  arFeeAtomic,
  price,
  currency,
  showTokenLogos,
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
  /** The selected token's spot price in `currency`; `undefined` when unpriced or still loading. */
  price: number | undefined;
  currency: DisplayCurrency | undefined;
  showTokenLogos: boolean;
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
  const denomination = token === null ? 12 : token.denomination;
  const ticker = tickerFor(token);
  // Every non-AR send is an AO data item, which not every wallet kind can sign.
  const unsupported = token === null ? null : capabilityRefusal(wallet.method, "signDataItem", `send ${ticker}`);
  const recipientValid = recipientSchema.safeParse(step.recipient).success;
  const amountValid = amountSchema(denomination).safeParse(step.amountDisplay).success;
  const canContinue = !step.submitting && unsupported === null && recipientValid && amountValid;
  // A disabled button names what's missing rather than leaving it to guesswork.
  const continueLabel = step.submitting
    ? "Estimating fee…"
    : !recipientValid
      ? "Enter an address"
      : !amountValid
        ? "Enter an amount"
        : "Review and Send";
  // For AR, Max is balance minus the rough fee estimate (clamped to 0),
  // hidden until that estimate resolves. This is still an underestimate
  // for a first-seen recipient — `handleContinue`'s post-estimate check
  // is the one that's actually enforced.
  const rawMaxAtomic =
    token === null
      ? balancesQuery.data?.arBalance
      : balancesQuery.data?.tokenBalances.find((candidate) => candidate.processId === token.processId)?.quantity;
  const maxAtomic =
    token === null
      ? rawMaxAtomic !== undefined && arFeeAtomic !== undefined
        ? (BigInt(rawMaxAtomic) > BigInt(arFeeAtomic) ? BigInt(rawMaxAtomic) - BigInt(arFeeAtomic) : 0n).toString()
        : undefined
      : rawMaxAtomic;
  const maxDisplay = maxAtomic === undefined ? undefined : formatAtomicAsDisplay(maxAtomic, denomination);
  const balanceDisplay = rawMaxAtomic === undefined ? undefined : formatAtomicAsDisplay(rawMaxAtomic, denomination);
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
  const balanceNumber = Number(balanceDisplay);
  const balanceValue =
    price !== undefined && currency !== undefined && currency !== ticker && balanceDisplay !== undefined && Number.isFinite(balanceNumber)
      ? formatCurrencyValue(balanceNumber * price, currency)
      : undefined;
  const identity = useAddressIdentity();

  if (showInfo) {
    return (
      <div className="flex min-h-full flex-col">
        <ScreenHeader title="Token details" onBack={() => onShowInfo(false)} />
        <div className="px-5 py-5">
          <TokenInfoPanel
            token={token && { ...token, logoUrl: shownTokenLogo(token, readRowVisibility(wallet.address), showTokenLogos) }}
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
        onBack={onBack}
        center={
          <div role="tablist" aria-label={`${ticker} actions`} className="flex items-center gap-1">
            {TOKEN_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                role="tab"
                aria-selected={action.id === "send"}
                className={`rounded-md px-2.5 py-1 text-body phone:hit-target ${action.id === "send" ? "font-semibold text-foreground" : "text-muted hover:text-foreground"}`}
              >
                {action.label}
              </button>
            ))}
          </div>
        }
        end={
          <button
            type="button"
            aria-label="Token details"
            onClick={() => onShowInfo(true)}
            className="flex max-w-[104px] flex-shrink-0 items-center gap-1 rounded-md px-1 py-1 text-label font-normal text-muted hover:text-foreground phone:hit-target focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-foreground"
          >
            <span aria-hidden="true">[</span>
            <span className="truncate">{ticker}</span>
            <span aria-hidden="true">]</span>
          </button>
        }
      />
      <div className="flex flex-1 flex-col gap-6 px-5 py-5 phone:pb-0">
        <div className="flex items-center justify-between gap-3 text-label">
          <span className="font-semibold text-muted">From</span>
          <span className="flex min-w-0 items-center gap-2">
            <AccountAvatar svgMarkup={identity.avatarSvg(wallet.address)} label={`${wallet.name} avatar`} size={20} />
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
            <span className="text-label font-semibold text-muted">Amount</span>
            <span className="flex items-center gap-1 text-label">
              {balanceDisplay !== undefined ? (
                <span className="tabular-nums text-muted">
                  {balanceDisplay} {ticker}
                </span>
              ) : null}
              {maxDisplay !== undefined ? (
                <button
                  type="button"
                  aria-label={`Max: ${maxDisplay}`}
                  onClick={() => onChange({ amountDisplay: maxDisplay })}
                  className="rounded-full px-2 py-1 text-caption font-semibold uppercase tracking-wide text-foreground hover:bg-mist phone:hit-target"
                >
                  Max
                </button>
              ) : null}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border border-line bg-background p-3.5 focus-within:border-foreground">
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                aria-label="Amount"
                placeholder="0"
                value={step.amountDisplay}
                onChange={(event) => {
                  const sanitized = sanitizeAmountInput(event.target.value);
                  const denomination = token === null ? 12 : token.denomination;
                  const atomic = parseDisplayToAtomic(sanitized, denomination);
                  if (atomic !== null && maxAtomic !== undefined && BigInt(atomic) > BigInt(maxAtomic)) {
                    return;
                  }
                  onChange({ amountDisplay: sanitized });
                }}
                onBlur={onBlurAmount}
                className="min-w-0 flex-1 border-none bg-transparent text-[26px] font-semibold tracking-[-0.01em] tabular-nums text-foreground placeholder:text-faint focus:outline-none"
              />
              <button
                type="button"
                onClick={onOpenTokenPicker}
                aria-haspopup="dialog"
                className="flex flex-shrink-0 items-center gap-1 rounded-[7px] border border-line bg-mist px-2.5 py-1.5 text-label font-bold text-foreground hover:bg-line phone:hit-target"
              >
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
        </div>

        {unsupported ? (
          <p role="status" className="rounded-md border border-l-[3px] border-line border-l-warning bg-mist px-3.5 py-3 text-label leading-snug text-foreground">
            {unsupported}
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
          ? "Camera access is off for Gleam. Turn it on in Settings to scan."
          : "Couldn't scan. Try again or paste the address.",
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-label font-semibold text-muted">To</span>
        {capabilities.qrScanner ? (
          <button
            type="button"
            aria-label="Scan QR code"
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
          onEdit={() => setEditing("refocus")}
        />
      ) : (
        <div className="relative">
          <input
            type="text"
            spellCheck={false}
            aria-label="Recipient address"
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
            placeholder="Paste an address"
            className="w-full rounded-md border border-line bg-background px-3.5 py-3 font-mono text-label leading-relaxed text-foreground focus:border-foreground focus:outline-none"
          />
          {showDropdown ? (
            <div
              role="listbox"
              aria-label="Saved contacts"
              // Keeps focus in the input, so a click lands before the blur closes the list.
              onMouseDown={(event) => event.preventDefault()}
              className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-line bg-background shadow-lg"
            >
              {shownSuggestions.length > 0 ? (
                // Its own wrapper, so the last row drops its separator.
                <div className="pb-1">
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
                className="w-full px-3.5 py-3 text-left text-label font-medium text-muted hover:bg-mist hover:text-foreground"
              >
                Saved contacts
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
  return (
    <div className="flex flex-col gap-2">
      {/* Keeps focus in the recipient input: its blur swaps in the shorter card, which moves this checkbox out from under the click. */}
      <label onMouseDown={(event) => event.preventDefault()} className="flex w-fit items-center gap-2 text-label text-muted phone:min-h-11 phone:gap-2.5">
        <input type="checkbox" checked={expanded} onChange={onToggle} className="h-3.5 w-3.5 accent-foreground phone:h-5 phone:w-5" />
        Save this address
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
            placeholder="Enter address name"
            className="min-w-0 flex-1 rounded-md border border-line bg-background px-3 py-2 text-label text-foreground focus:border-foreground focus:outline-none"
          />
          <button
            type="button"
            disabled={name.trim().length === 0 || saving}
            onClick={onConfirm}
            className="flex-shrink-0 text-label font-semibold text-foreground underline-offset-2 hover:underline disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ReviewStep({
  token,
  step,
  contact,
  ownWallet,
  emphasisPick,
  signsOnDevice,
  onBack,
  onSign,
}: {
  token: TokenBalance | null;
  step: Extract<Step, { kind: "review" }>;
  /** A saved contact for `step.recipient`, if any — a known recipient skips first-seen framing. */
  contact: Contact | undefined;
  /** One of the vault's own other wallets, if `step.recipient` is its address — same known-recipient treatment as a saved contact. */
  ownWallet: WalletSummary | undefined;
  emphasisPick: number | null;
  /** A hardware wallet signs in the approval window the background opens; the popup may close when it takes focus. */
  signsOnDevice: boolean;
  onBack: () => void;
  onSign: () => void;
}) {
  const ticker = tickerFor(token);
  // A legacy AO transfer has no sender-side fee (`estimate.fee` is `null`),
  // so the Fee row says so rather than showing a fabricated "0 <TICKER>".
  // An L1 token transfer's fee is AR, a different unit from the amount,
  // so only an AR send folds the fee into its total.
  const total =
    step.estimate.fee === null || token !== null
      ? step.amountAtomic
      : (BigInt(step.amountAtomic) + BigInt(step.estimate.fee)).toString();
  // A saved contact or one of your own wallets counts as a known recipient
  // even if the backend's own activity-log-based `firstSeenRecipient`
  // check has no record of it yet (e.g. a contact saved from elsewhere, or
  // a wallet you've never actually sent to before).
  const known = contact ?? ownWallet;
  const lookalikeOf = known ? null : (step.estimate.lookalikeOf ?? null);
  const irreversible = (step.estimate.firstSeenRecipient && !known) || lookalikeOf !== null;
  const knownName = contact?.name ?? ownWallet?.name;
  const identity = useAddressIdentity();
  const avatarSvg = identity.avatarSvg(step.recipient);
  const lookalikeAvatarSvg = lookalikeOf ? identity.avatarSvg(lookalikeOf) : undefined;

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Review send" onBack={onBack} busy={step.submitting} />
      <div className="flex flex-1 flex-col gap-6 px-5 py-5 phone:pb-0">
        <div className="flex flex-col items-center gap-1 pb-1 pt-2 text-center">
          <span className="text-[30px] font-semibold tracking-[-0.02em] tabular-nums text-foreground">
            {formatAmount(step.amountAtomic, token)} {ticker}
          </span>
        </div>

        {irreversible ? (
          <RecipientWarning
            firstTime={step.estimate.firstSeenRecipient && !known}
            lookalikeOf={lookalikeOf}
            lookalikeAvatarSvg={lookalikeAvatarSvg}
            emphasisPick={emphasisPick}
          />
        ) : null}

        <div className="flex flex-col gap-1.5">
          <span className="text-label font-semibold text-muted">To</span>
          <RecipientCard
            address={step.recipient}
            name={knownName ?? null}
            avatarSvg={avatarSvg}
            emphasisPick={emphasisPick}
            tone="confirm"
          />
        </div>

        <div className="flex flex-col">
          <ReviewRow
            label="Fee"
            value={step.estimate.fee === null ? "No network fee" : `${formatWinstonAsAr(step.estimate.fee)} AR`}
          />
          <ReviewRow label="Total" value={`${formatAmount(total, token)} ${ticker}`} strong />
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

        <ScreenFooter pinned={false}>
          {irreversible ? null : <p className="text-center text-label text-muted">This cannot be undone.</p>}
          <Button
            type="button"
            variant={irreversible ? "destructive" : "primary"}
            disabled={step.submitting}
            aria-busy={step.submitting}
            onClick={onSign}
          >
            {step.submitting
              ? signsOnDevice
                ? "Waiting for approval…"
                : "Sending…"
              : `Send ${formatAmount(step.amountAtomic, token)} ${ticker}`}
          </Button>
        </ScreenFooter>
      </div>
    </div>
  );
}

export function ReviewRow({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 text-label last:border-b-0 phone:border-b-0 phone:py-3">
      <span className="text-muted">{label}</span>
      <span
        className={`text-right tabular-nums text-foreground ${strong ? "font-bold" : "font-semibold"} ${mono ? "max-w-[220px] break-all font-mono text-[11px] font-medium" : ""}`}
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
  showTokenLogos,
  selectedToken,
  onSelect,
  onBack,
}: {
  walletAddress: string;
  balancesQuery: UseQueryResult<WalletBalances>;
  showTokenLogos: boolean;
  selectedToken: TokenBalance | null;
  onSelect: (token: TokenBalance | null) => void;
  onBack: () => void;
}) {
  const loading = balancesQuery.isLoading;
  const errorMessage = balancesQuery.error
    ? balancesQuery.error instanceof Error
      ? balancesQuery.error.message
      : String(balancesQuery.error)
    : null;

  const aoBalance = balancesQuery.data?.tokenBalances.find(
    (candidate) => candidate.processId === DEFAULT_AO_TOKEN.processId,
  );
  const aoToken = aoBalance ?? defaultAoTokenBalance(walletAddress);
  const visibility = readRowVisibility(walletAddress);
  const otherTokenBalances = (balancesQuery.data?.tokenBalances ?? []).filter(
    (candidate) => candidate.processId !== DEFAULT_AO_TOKEN.processId,
  );

  return (
    <div className="flex min-h-full flex-col" role="dialog" aria-label="Select token">
      <ScreenHeader title="Select token" onBack={onBack} />
      <div className="flex flex-1 flex-col px-1 py-2 phone:px-5">
        {errorMessage ? (
          <div role="alert" className="px-4 py-3 text-label leading-snug text-warning phone:px-0">
            {errorMessage}
          </div>
        ) : null}

        <TokenRow
          glyph={{ label: DEFAULT_AR_TOKEN.ticker, tone: 1 }}
          name={DEFAULT_AR_TOKEN.name}
          amount={
            balancesQuery.data === undefined
              ? DEFAULT_AR_TOKEN.defaultDisplayAmount
              : formatWinstonAsAr(balancesQuery.data.arBalance)
          }
          loading={loading}
          onClick={() => onSelect(null)}
          className={selectedToken === null ? "bg-mist" : undefined}
        />

        <TokenRow
          glyph={{ label: DEFAULT_AO_TOKEN.ticker, tone: 2 }}
          name={DEFAULT_AO_TOKEN.name}
          amount={
            aoBalance
              ? aoBalance.available === false
                ? UNAVAILABLE_TOKEN_BALANCE_LABEL
                : formatAtomicAsDisplay(aoBalance.quantity, aoBalance.denomination)
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
              glyph={{ label: displayTicker(candidate.ticker).slice(0, 2).toUpperCase(), tone: 2, logoUrl: shownTokenLogo(candidate, visibility, showTokenLogos) }}
              name={displayTicker(candidate.ticker)}
              amount={
                candidate.available === false
                  ? UNAVAILABLE_TOKEN_BALANCE_LABEL
                  : formatAtomicAsDisplay(candidate.quantity, candidate.denomination)
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
  onBack,
}: {
  runtime: RuntimePort;
  wallet: WalletSummary;
  contacts: Contact[];
  contactsLoading: boolean;
  otherWallets: WalletSummary[];
  otherWalletsLoading: boolean;
  onSelect: (recipient: string) => void;
  onBack: () => void;
}) {
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
    <div className="flex min-h-full flex-col" role="dialog" aria-label="Saved contacts">
      <ScreenHeader title="Saved contacts" onBack={onBack} />
      <div className="px-3.5 pb-2 pt-3 phone:px-5">
        <input
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search by name or address"
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-label text-foreground focus:border-foreground focus:outline-none"
        />
      </div>
      <div className="flex flex-1 flex-col px-1 py-2 phone:px-5">
        {activityQuery.isError ? (
          <div role="alert" className="px-4 py-3 text-label leading-snug text-warning phone:px-0">
            {activityQuery.error instanceof Error ? activityQuery.error.message : String(activityQuery.error)}
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
                ? "No matching addresses."
                : "No saved contacts yet. Addresses you save or send to will show up here."
            }
          />
        ) : (
          <>
            {filteredContacts.length > 0 ? (
              <PickerSection label="Contacts">
                {filteredContacts.map((contact) => (
                  <AddressRow key={contact.address} address={contact.address} name={contact.name} onSelect={() => onSelect(contact.address)} />
                ))}
              </PickerSection>
            ) : null}
            {filteredWallets.length > 0 ? (
              <PickerSection label="Your wallets">
                {filteredWallets.map((candidate) => (
                  <AddressRow key={candidate.address} address={candidate.address} name={candidate.name} onSelect={() => onSelect(candidate.address)} />
                ))}
              </PickerSection>
            ) : null}
            {filteredRecent.length > 0 ? (
              <PickerSection label="Recent">
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
      <div className="px-3.5 pb-1.5 pt-3 text-caption font-semibold uppercase tracking-wide text-faint phone:px-0">{label}</div>
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
      <h2 className="text-body text-foreground">Signed and sent.</h2>
      <p className="-mt-2 break-words text-label text-muted">{summary}</p>
      <div className="mt-2 flex w-full items-center gap-2 border-b border-line py-3 text-label text-muted phone:border-b-0">
        <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-beam-yellow" />
        <span>Pending confirmation</span>
      </div>
      <a
        href={explorerUrlFor(txId)}
        target="_blank"
        rel="noopener noreferrer"
        className="-mt-1 text-label font-semibold text-muted underline-offset-2 hover:text-foreground hover:underline"
      >
        View in explorer
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
                placeholder="Enter address name"
                className="min-w-0 flex-1 rounded-md border border-line bg-background px-3 py-2 text-label text-foreground focus:border-foreground focus:outline-none"
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
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSave(true)}
              className="text-label font-medium text-muted hover:text-foreground hover:underline"
            >
              Save as contact
            </button>
          )}
        </div>
      ) : null}

      <ScreenFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </ScreenFooter>
    </div>
  );
}
