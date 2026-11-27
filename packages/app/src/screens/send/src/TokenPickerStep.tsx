import type { UseQueryResult } from "@tanstack/react-query";
import type { TokenBalance } from "@gleam/core";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { TokenRow } from "@gleam/ui/src/components/wallet/index.ts";
import { DEFAULT_AO_TOKEN, DEFAULT_AR_TOKEN } from "@gleam/ui";
import { t, useLocale, useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { isTokenHidden, readRowVisibility, sendTokenLogo, shownTokenLogo } from "../../../token-visibility";
import { formatTokenAmount } from "../../main-screen/src/formatTokenAmount";
import { displayTicker } from "../../main-screen/src/formatWinston";
import type { WalletBalances } from "../../activity";
import { SkeletonPickerRow } from "./SkeletonPickerRow";

/**
 * Shown in place of a formatted amount for a `TokenBalance` whose
 * `available` is `false` (`handlers/reads.ts`: a failed HyperBEAM read, or
 * an unconfirmed non-AO denomination) — such a row's `quantity`/
 * `denomination` can't be trusted for display or for a max-send check, so
 * the row is shown but not selectable (`onClick` omitted).
 */
const unavailableTokenBalanceLabel = () => t("send.unavailable");

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
    // AO's own scale, so an amount typed before the balances load converts right.
    denomination: 12,
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
export function TokenPickerStep({
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
  const locale = useLocale();
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
      <div className="flex flex-1 flex-col px-1 py-2 phone:px-5 silica:gap-2 silica:px-5">
        {errorMessage ? (
          <InlineError size="label" as="div" className="px-4 py-3 phone:px-0">
            {errorMessage}
          </InlineError>
        ) : null}

        <TokenRow
          glyph={{ label: DEFAULT_AR_TOKEN.ticker, tone: 1, logoUrl: sendTokenLogo(null, visibility, tokenLogos) }}
          name={DEFAULT_AR_TOKEN.name}
          amount={
            balancesQuery.data === undefined
              ? DEFAULT_AR_TOKEN.defaultDisplayAmount
              : formatTokenAmount(balancesQuery.data.arBalance, 12, locale)
          }
          loading={loading}
          onClick={() => onSelect(null)}
          className="border-b-0"
        />

        <TokenRow
          glyph={{ label: DEFAULT_AO_TOKEN.ticker, tone: 2, logoUrl: sendTokenLogo(aoToken, visibility, tokenLogos) }}
          name={DEFAULT_AO_TOKEN.name}
          amount={
            aoBalance
              ? aoBalance.available === false
                ? unavailableTokenBalanceLabel()
                : formatTokenAmount(aoBalance.quantity, aoBalance.denomination, locale)
              : DEFAULT_AO_TOKEN.defaultDisplayAmount
          }
          loading={loading}
          onClick={aoBalance?.available === false ? undefined : () => onSelect(aoToken)}
          className="border-b-0"
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
                  : formatTokenAmount(candidate.quantity, candidate.denomination, locale)
              }
              onClick={candidate.available === false ? undefined : () => onSelect(candidate)}
              className="border-b-0"
            />
          ))
        )}
      </div>
    </div>
  );
}
