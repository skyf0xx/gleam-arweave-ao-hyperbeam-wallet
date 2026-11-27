import type { UseQueryResult } from "@tanstack/react-query";
import { capabilityRefusal, type DisplayCurrency, type RuntimePort, type TokenBalance, type TransferFeeQuote, type WalletSummary } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { AccountAvatar, TokenGlyph } from "@gleam/ui/src/components/wallet/index.ts";
import { formatCurrencyValue } from "@gleam/ui/src/format/currency.ts";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { useAddressIdentity } from "../../../address-identity";
import { useLocale, useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { readRowVisibility, sendTokenLogo } from "../../../token-visibility";
import { feeFiatText } from "../../../transfer-review/model";
import { formatTokenAmount } from "../../main-screen/src/formatTokenAmount";
import { formatAtomicAsDisplay, parseDisplayToAtomic } from "../../main-screen/src/formatWinston";
import type { WalletBalances } from "../../activity";
import { validateSendAmount } from "../../activity";
import type { NamedAddress } from "./namedAddresses";
import { NetworkFeeLine } from "./NetworkFeeLine";
import { RecipientField } from "./RecipientField";
import { amountSchema, recipientSchema } from "./sendFormSchema";
import type { Step } from "./sendStep";
import { tickerFor } from "./sendTokenFormat";
import { TokenHeaderTitle, TokenInfoPanel } from "./TokenInfoPanel";
import { hasPriceHistory, TokenPriceChart } from "./TokenPriceChart";

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

export function ComposeStep({
  runtime,
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
  runtime: RuntimePort;
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
  const locale = useLocale();
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
  const balanceDisplay = rawMaxAtomic === undefined ? undefined : formatTokenAmount(rawMaxAtomic, denomination, locale);
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
  const feeAtomic = feeQuote.data?.fee ?? null;
  const feeFiat = feeFiatText(feeAtomic, {
    currency,
    prices: arPrice === undefined ? undefined : [{ processId: null, price: arPrice, change24h: null }],
  });
  const identity = useAddressIdentity();

  if (showInfo) {
    return (
      <div className="flex min-h-full flex-col">
        <ScreenHeader
          title={t("send.tokenDetails")}
          center={<TokenHeaderTitle token={token} logoUrl={sendTokenLogo(token, readRowVisibility(wallet.address), tokenLogos)} />}
          onBack={() => onShowInfo(false)}
        />
        <div className="px-6 py-5 phone:px-5">
          <TokenInfoPanel
            runtime={runtime}
            token={token}
            priceDisplay={price !== undefined && currency !== undefined && currency !== ticker ? formatCurrencyValue(price, currency) : undefined}
            chart={
              currency !== undefined && currency !== ticker && hasPriceHistory(token?.processId ?? null) ? (
                <TokenPriceChart runtime={runtime} processId={token?.processId ?? null} currency={currency} />
              ) : null
            }
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
                  className="rounded-full px-2 py-1 text-caption font-semibold uppercase tracking-wide text-foreground hover:bg-hover phone:hit-target"
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
                className="min-w-0 flex-1 border-none bg-transparent text-display-sm font-semibold dark:font-medium tracking-[-0.01em] tabular-nums text-foreground placeholder:text-faint focus:outline-none"
              />
              <button
                type="button"
                onClick={onOpenTokenPicker}
                aria-haspopup="dialog"
                className="gleam-hover-frost flex flex-shrink-0 items-center gap-1.5 rounded-[7px] border border-line bg-mist py-1.5 pl-1.5 pr-2.5 text-label font-bold text-foreground hover:bg-line silica:hover:bg-mist phone:hit-target"
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
            <InlineError size="label" as="div">
              {step.amountError}
            </InlineError>
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

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
