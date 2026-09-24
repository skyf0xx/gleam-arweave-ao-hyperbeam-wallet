import { useMemo, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { explorerUrlFor, type ActivityPage, type Contact, type FeeEstimate, type RuntimePort, type TokenBalance, type WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { RiskNotice } from "@gleam/ui/src/primitives/risk-notice.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { AccountAvatar, EmptyState, TokenRow } from "@gleam/ui/src/components/wallet/index.ts";
import { DEFAULT_AO_TOKEN, DEFAULT_AR_TOKEN } from "@gleam/ui";
import { displayTicker, formatAtomicAsDisplay, formatWinstonAsAr, truncateAddress } from "../../main-screen/src/formatWinston";
import { generateAccountAvatarSvg } from "../../main-screen/src/generateAccountAvatar";
import { useActivity } from "../../activity/src/useActivity";
import { useArFee } from "../../activity/src/useArFee";
import { useBalances, type WalletBalances } from "../../activity/src/useBalances";
import { useContacts, useSaveContact } from "../../activity/src/useContacts";
import { useOtherWallets } from "../../activity/src/useOtherWallets";
import { useSubmitTransfer } from "../../activity/src/useSubmitTransfer";
import { validateSendAmount } from "../../activity/src/validateSendAmount";
import { amountSchema, firstIssueMessage, recipientSchema } from "./sendFormSchema";

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
 * label that used to read "Recent" is now "Saved addresses" everywhere in
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
 * (`apps/extension/src/handlers/key-session.ts`), not from this request —
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
  // Shared cache with `MainScreenView` (`useBalances`, keyed by
  // `wallet.address`) — the compose step's client-side "insufficient
  // balance" check reads this same query's current data rather than
  // issuing its own fetch.
  const balancesQuery = useBalances(runtime, wallet.address);
  // AR-only network fee estimate, independent of the balances query — feeds
  // the compose step's "Max" affordance and its balance check (see
  // `useArFee`'s own doc comment for why it isn't wallet-address-keyed).
  const arFeeQuery = useArFee(runtime);
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
        const finalBalanceError = validateSendAmount(amountAtomic, selectedToken, balancesQuery.data, estimate.fee ?? undefined);
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
        step={step}
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
        selectedToken={selectedToken}
        onSelect={(nextToken) => {
          setSelectedToken(nextToken);
          setStep(savedComposeStep || INITIAL_STEP);
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
        onBack={() => setStep({ ...INITIAL_STEP, recipient: step.recipient })}
        onSign={() => void handleSign()}
      />
    );
  }

  return (
    <SuccessStep
      token={selectedToken}
      step={step}
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
  step,
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
  step: Extract<Step, { kind: "compose" }>;
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
  const canContinue =
    !step.submitting &&
    recipientSchema.safeParse(step.recipient).success &&
    amountSchema(denomination).safeParse(step.amountDisplay).success;
  const ticker = tickerFor(token);
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

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={`Send ${ticker}`} onBack={onBack} />
      <div className="flex flex-1 flex-col gap-6 px-5 py-5">
        <div className="flex items-center justify-between text-label">
          <span className="font-semibold text-muted">From</span>
          <span className="font-semibold text-foreground">{wallet.name}</span>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-label font-semibold text-muted">To</span>
            <button
              type="button"
              onClick={onOpenSavedAddresses}
              className="text-label font-medium text-muted hover:text-foreground hover:underline"
            >
              Saved addresses
            </button>
          </div>
          <textarea
            rows={2}
            value={step.recipient}
            onChange={(event) => onChange({ recipient: event.target.value })}
            onBlur={onBlurRecipient}
            placeholder="Paste an address"
            className="w-full resize-none rounded-md border border-line bg-background px-3.5 py-3 font-mono text-label leading-relaxed text-foreground focus:border-foreground focus:outline-none"
          />
          {step.recipientError ? (
            <div role="alert" className="text-label leading-snug text-warning">
              {step.recipientError}
            </div>
          ) : null}
          {!step.recipientError && recipientSchema.safeParse(step.recipient).success && !hideSaveOption ? (
            <SaveAddressInline
              expanded={step.showSaveAddress}
              name={step.saveAddressName}
              saving={savingAddress}
              onToggle={onToggleSaveAddress}
              onChangeName={onChangeSaveAddressName}
              onConfirm={onConfirmSaveAddress}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-label font-semibold text-muted">Amount</span>
            {maxDisplay !== undefined ? (
              <button
                type="button"
                onClick={() => onChange({ amountDisplay: maxDisplay })}
                className="text-label font-medium text-muted hover:text-foreground hover:underline"
              >
                Max: {maxDisplay}
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2.5 rounded-md border border-line bg-background p-3.5 focus-within:border-foreground">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
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
              className="min-w-0 flex-1 border-none bg-transparent text-[26px] font-semibold tracking-[-0.01em] tabular-nums text-foreground focus:outline-none"
            />
            <button
              type="button"
              onClick={onOpenTokenPicker}
              aria-haspopup="dialog"
              className="flex flex-shrink-0 items-center gap-1 rounded-full border border-line bg-mist px-2.5 py-1.5 text-label font-bold text-foreground hover:bg-line"
            >
              {ticker}
              <ChevronDownIcon />
            </button>
          </div>
          {step.amountError ? (
            <div role="alert" className="text-label leading-snug text-warning">
              {step.amountError}
            </div>
          ) : null}
        </div>

        <Button type="button" disabled={!canContinue} aria-busy={step.submitting} onClick={onContinue} className="mt-auto">
          {step.submitting ? "Checking…" : "Continue"}
        </Button>
      </div>
    </div>
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
      <label className="flex w-fit items-center gap-2 text-label text-muted">
        <input type="checkbox" checked={expanded} onChange={onToggle} className="h-3.5 w-3.5 accent-foreground" />
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
  onBack,
  onSign,
}: {
  token: TokenBalance | null;
  step: Extract<Step, { kind: "review" }>;
  /** A saved contact for `step.recipient`, if any — a known recipient skips first-seen framing. */
  contact: Contact | undefined;
  /** One of the vault's own other wallets, if `step.recipient` is its address — same known-recipient treatment as a saved contact. */
  ownWallet: WalletSummary | undefined;
  onBack: () => void;
  onSign: () => void;
}) {
  const ticker = tickerFor(token);
  // AO transfers have no sender-side fee quote — `estimate.fee` is `null`
  // for that path (see `core/ao/transfer.ts`'s `AO_TRANSFER_HAS_NO_FEE` doc
  // comment). The total then equals the send amount itself, and the Fee row
  // says so explicitly rather than showing a fabricated "0 <TICKER>".
  const total =
    step.estimate.fee === null
      ? step.amountAtomic
      : (BigInt(step.amountAtomic) + BigInt(step.estimate.fee)).toString();
  // A saved contact or one of your own wallets counts as a known recipient
  // even if the backend's own activity-log-based `firstSeenRecipient`
  // check has no record of it yet (e.g. a contact saved from elsewhere, or
  // a wallet you've never actually sent to before).
  const known = contact ?? ownWallet;
  const irreversible = step.estimate.firstSeenRecipient && !known;
  const knownName = contact?.name ?? ownWallet?.name;

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Review send" onBack={onBack} />
      <div className="flex flex-1 flex-col gap-6 px-5 py-5">
        <div className="flex flex-col items-center gap-1 pb-1 pt-2 text-center">
          <span className="text-[30px] font-semibold tracking-[-0.02em] tabular-nums text-foreground">
            {formatAmount(step.amountAtomic, token)} {ticker}
          </span>
        </div>

        {irreversible ? (
          <RiskNotice>
            <strong className="font-bold">You haven&apos;t sent to this address before.</strong> Double-check
            it&apos;s correct. This can&apos;t be undone once signed.
          </RiskNotice>
        ) : (
          <p className="text-label leading-relaxed text-muted">
            You&apos;re sending {formatAmount(step.amountAtomic, token)} {ticker} to this address. This can&apos;t
            be undone.
          </p>
        )}

        {knownName ? (
          <div className="-mb-2 flex items-center justify-between text-label">
            <span className="text-muted">Recipient</span>
            <span className="font-semibold text-foreground">{knownName}</span>
          </div>
        ) : null}

        <div className="flex flex-col">
          <ReviewRow label={knownName ? "Address" : "Recipient"} value={step.recipient} mono />
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

        <Button
          type="button"
          variant={irreversible ? "destructive" : "primary"}
          disabled={step.submitting}
          aria-busy={step.submitting}
          onClick={onSign}
          className="mt-auto"
        >
          {step.submitting ? "Signing…" : "Sign and send"}
        </Button>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2.5 text-label last:border-b-0 last:border-t last:pt-3">
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
  selectedToken,
  onSelect,
  onBack,
}: {
  walletAddress: string;
  balancesQuery: UseQueryResult<WalletBalances>;
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
  const otherTokenBalances = (balancesQuery.data?.tokenBalances ?? []).filter(
    (candidate) => candidate.processId !== DEFAULT_AO_TOKEN.processId,
  );

  return (
    <div className="flex min-h-full flex-col" role="dialog" aria-label="Select token">
      <ScreenHeader title="Select token" onBack={onBack} />
      <div className="flex flex-1 flex-col px-1 py-2">
        {errorMessage ? (
          <div role="alert" className="px-4 py-3 text-label leading-snug text-warning">
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
              glyph={{ label: displayTicker(candidate.ticker).slice(0, 2).toUpperCase(), tone: 2 }}
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
    <div className="flex w-full items-center gap-2.5 border-b border-line px-3.5 py-3 last:border-b-0">
      <div className="h-8 w-8 flex-shrink-0 animate-pulse rounded-full bg-mist" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="h-3 w-20 animate-pulse rounded bg-mist" />
        <div className="h-2.5 w-10 animate-pulse rounded bg-mist" />
      </div>
    </div>
  );
}

/**
 * Saved addresses picker — replaces the old "Recent recipients" screen per
 * `todo.md`'s "Address book, part 1" (the user's own minimalism note:
 * "opening that screen can display recent as well as saved"). Three
 * sections, in order: saved contacts (`useContacts`, vault-wide), "Your
 * wallets" (`useOtherWallets` — every other wallet in the vault, never the
 * active one), then recent send recipients (from the shared `useActivity`
 * cache) — each section excludes any address already shown in an earlier
 * one so nothing appears twice. A text field at the top filters every
 * section by name or address substring as you type (case-insensitive),
 * per the reviewer's spec. Selecting any row fills the recipient field
 * with the full address; truncated display only. Every row — contact,
 * wallet or plain recent address — uses the same dicebear identicon as
 * `WalletSwitcherView`'s own rows (`generateAccountAvatarSvg` + `AccountAvatar`),
 * not initials in a circle, so an address looks the same wherever it's
 * shown across the extension.
 */
function SavedAddressesStep({
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
  const filteredRecent = recentOnly.filter((address) => matches(null, address));

  const loading = contactsLoading || otherWalletsLoading || activityQuery.isLoading;
  const isEmpty =
    !loading && filteredContacts.length === 0 && filteredWallets.length === 0 && filteredRecent.length === 0;

  return (
    <div className="flex min-h-full flex-col" role="dialog" aria-label="Saved addresses">
      <ScreenHeader title="Saved addresses" onBack={onBack} />
      <div className="px-3.5 pb-2 pt-3">
        <input
          type="text"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search by name or address"
          className="w-full rounded-md border border-line bg-background px-3 py-2 text-label text-foreground focus:border-foreground focus:outline-none"
        />
      </div>
      <div className="flex flex-1 flex-col px-1 py-2">
        {activityQuery.isError ? (
          <div role="alert" className="px-4 py-3 text-label leading-snug text-warning">
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
                : "No saved addresses yet. Addresses you save or send to will show up here."
            }
          />
        ) : (
          <>
            {filteredContacts.map((contact) => (
              <AddressRow key={contact.address} address={contact.address} name={contact.name} onSelect={() => onSelect(contact.address)} />
            ))}
            {filteredWallets.length > 0 ? (
              <div className="px-3.5 pb-1.5 pt-3 text-caption font-semibold uppercase tracking-wide text-faint">Your wallets</div>
            ) : null}
            {filteredWallets.map((candidate) => (
              <AddressRow key={candidate.address} address={candidate.address} name={candidate.name} onSelect={() => onSelect(candidate.address)} />
            ))}
            {filteredRecent.map((address) => (
              <AddressRow key={address} address={address} name={null} onSelect={() => onSelect(address)} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function AddressRow({ address, name, onSelect }: { address: string; name: string | null; onSelect: () => void }) {
  const avatarSvg = useMemo(() => generateAccountAvatarSvg(address), [address]);
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 border-b border-line px-3.5 py-3 text-left last:border-b-0 hover:bg-mist"
    >
      <AccountAvatar svgMarkup={avatarSvg} label={name ? `${name} avatar` : "Address avatar"} size={32} className="rounded-2xl" />
      {name ? (
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-label font-semibold text-foreground">{name}</span>
          <span className="truncate font-mono text-caption text-faint">{truncateAddress(address)}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-label text-foreground">{truncateAddress(address)}</span>
      )}
    </button>
  );
}

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

function SuccessStep({
  token,
  step,
  onDone,
  isSaved,
  onSaveAddress,
  saving,
}: {
  token: TokenBalance | null;
  step: Extract<Step, { kind: "success" }>;
  onDone: () => void;
  /** Whether `step.recipient` is already a saved contact — hides "Save as contact" when true. */
  isSaved: boolean;
  onSaveAddress: (name: string) => void;
  saving: boolean;
}) {
  const ticker = tickerFor(token);
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex min-h-full flex-col items-center gap-4 px-6 pb-6 pt-12 text-center">
      <div className="mb-1 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-mist text-foreground">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="text-body text-foreground">Signed and sent.</h2>
      <p className="-mt-2 text-label text-muted">
        {formatAmount(step.amountAtomic, token)} {ticker} to {step.recipient}
      </p>
      <div className="mt-2 flex w-full items-center gap-2 border-b border-line py-3 text-label text-muted">
        <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-beam-yellow" />
        <span>Pending confirmation</span>
      </div>
      <a
        href={explorerUrlFor(step.txId)}
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

      <Button type="button" onClick={onDone} className="mt-auto">
        Done
      </Button>
    </div>
  );
}
