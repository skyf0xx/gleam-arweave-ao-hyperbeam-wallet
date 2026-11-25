import type { ReactNode } from "react";
import type { DisplayCurrency, RuntimePort, TokenBalance, TokenPrice, WalletSummary } from "@gleam/core";
import { SkeletonRow, TokenRow } from "@gleam/ui/src/components/wallet/index.ts";
import { HIDDEN_AMOUNT } from "@gleam/ui/src/format/currency.ts";
import { ChevronIcon } from "@gleam/ui/src/primitives/chevron-icon.tsx";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { displayTicker, formatAtomicAsDisplay, formatAtomicCompact } from "./formatWinston";
import { useLocale, useT } from "../../../i18n";
import { shownTokenLogo } from "../../../token-visibility";
import type { WalletBalances } from "../../activity/src/useBalances";
import { PointsTokenRow } from "../../points/index.tsx";
import { ChevronRightIcon, PlusIcon } from "./homeIcons";
import {
  changeFor,
  nonDefaultTokenBalances,
  pendingNote,
  unavailableBalanceLabel,
  unitPriceFor,
  valueFor,
  withPendingNote,
  type DefaultTokenRow,
  type ListedTokenRow,
} from "./tokenRows";
import type { TokenRowControls } from "./useTokenRowControls";

export interface TokensPanelProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  /** No balances or activity read has finished yet. */
  showSkeleton: boolean;
  balances: WalletBalances | undefined;
  balancesWaiting: boolean;
  defaultTokenRows: DefaultTokenRow[];
  tokenPrices: TokenPrice[] | undefined;
  currency: DisplayCurrency | undefined;
  masked: boolean;
  simpleRows: boolean;
  tokenLogos: boolean;
  watchOnly: boolean;
  tokensCached: boolean;
  controls: TokenRowControls;
  hiddenExpanded: boolean;
  setHiddenExpanded: (update: (expanded: boolean) => boolean) => void;
  toggleHiddenExpanded: () => void;
  listDocked: boolean;
  onSend: () => void;
  onSendToken: (token: TokenBalance) => void;
  onOpenPoints: () => void;
  onAddToken: () => void;
}

/** The Tokens tab: the AR/AO rows, Gleam Points and watched tokens, with the hidden-tokens disclosure and its edit mode. */
export function TokensPanel({
  runtime,
  wallet,
  showSkeleton,
  balances,
  balancesWaiting,
  defaultTokenRows,
  tokenPrices,
  currency,
  masked,
  simpleRows,
  tokenLogos,
  watchOnly,
  tokensCached,
  controls,
  hiddenExpanded,
  setHiddenExpanded,
  toggleHiddenExpanded,
  listDocked,
  onSend,
  onSendToken,
  onOpenPoints,
  onAddToken,
}: TokensPanelProps): ReactNode {
  const t = useT();
  const locale = useLocale();
  const { rowVisibility, isRowHidden, toggleRowHidden, confirmingIgnore, ignoreFailed, setIgnoreFailed, setConfirming, ignoreToken } = controls;
  if (showSkeleton) {
    return (
      <div className="min-h-60 phone:min-h-0">
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }
  const rows: ListedTokenRow[] = [
    ...defaultTokenRows.map(({ send, ...row }) => ({
      key: row.key,
      label: row.name,
      defaultHidden: false,
      node: (
        <TokenRow
          glyph={{ label: row.ticker.slice(0, 2).toUpperCase(), tone: 2, logoUrl: tokenLogos ? row.logoUrl : undefined }}
          name={row.name}
          amount={withPendingNote(masked ? HIDDEN_AMOUNT : row.amount, pendingNote(t, row.pending, 12, masked))}
          value={
            row.value === undefined ? undefined : masked ? HIDDEN_AMOUNT : row.value.text
          }
          // `amount @ price` would give the hidden holding away.
          unitPrice={masked || simpleRows ? undefined : row.unitPrice}
          change={simpleRows ? undefined : row.change}
          loading={balancesWaiting}
          cached={tokensCached}
          onClick={send === null || watchOnly ? undefined : send === "ar" ? onSend : () => onSendToken(send)}
          className="border-b-0"
        />
      ),
    })),
    {
      key: "gleam-points",
      label: "Gleam Points",
      defaultHidden: false,
      node: <PointsTokenRow runtime={runtime} wallet={wallet} onOpen={onOpenPoints} showLogo={tokenLogos} className="border-b-0" />,
    },
    ...nonDefaultTokenBalances(balances).map((token) => {
      const discovered = token.source === "discovered";
      const amountNumber =
        token.available === false ? 0 : Number(formatAtomicAsDisplay(token.quantity, token.denomination, token.denomination));
      const value = discovered || token.available === false ? undefined : valueFor(tokenPrices, currency, token.processId, amountNumber);
      return {
        key: token.processId,
        label: displayTicker(token.ticker),
        processId: token.processId,
        // Anyone can send a token, so one the user didn't add starts hidden.
        defaultHidden: discovered,
        node: (
          <TokenRow
            glyph={{
              label: token.ticker.slice(0, 2).toUpperCase(),
              tone: 2,
              logoUrl: shownTokenLogo(token, rowVisibility, tokenLogos),
            }}
            name={displayTicker(token.ticker)}
            amount={
              token.available === false
                ? unavailableBalanceLabel(t)
                : withPendingNote(
                    masked ? HIDDEN_AMOUNT : formatAtomicCompact(token.quantity, token.denomination),
                    pendingNote(t, token.pending, token.denomination, masked),
                  )
            }
            value={value === undefined ? undefined : masked ? HIDDEN_AMOUNT : value.text}
            unitPrice={masked || simpleRows || value === undefined ? undefined : unitPriceFor(tokenPrices, currency, token.processId, token.ticker, amountNumber)}
            change={simpleRows || value === undefined ? undefined : changeFor(tokenPrices, token.processId)}
            cached={tokensCached}
            onClick={token.available === false || watchOnly ? undefined : () => onSendToken(token)}
            className="border-b-0"
          />
        ),
      };
    }),
  ].sort((a, b) => a.label.localeCompare(b.label, locale, { sensitivity: "base" }));
  const hiddenRows = rows.filter(isRowHidden);
  const renderRow = (row: ListedTokenRow) => {
    const hidden = isRowHidden(row);
    const { processId } = row;
    const confirming = processId !== undefined && confirmingIgnore.has(processId);
    const actionClassName =
      "rounded-md bg-mist px-2 py-1 text-caption font-semibold text-muted hover:text-foreground phone:flex phone:min-h-11 phone:items-center phone:px-3.5";
    return (
      <div key={row.key} data-editing={hiddenExpanded || undefined} className="group relative">
        {row.node}
        {hiddenExpanded ? (
          <div
            className={cn(
              "absolute right-3.5 top-1/2 flex -translate-y-1/2 gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100 phone:right-0 phone:opacity-100 phone:silica:right-3.5",
              confirming && "opacity-100",
            )}
          >
            {confirming ? (
              <>
                <button
                  type="button"
                  aria-label={t("mainScreen.cancelIgnoreLabel", { label: row.label })}
                  onClick={() => setConfirming(processId, false)}
                  className={actionClassName}
                >
                  {t("mainScreen.cancel")}
                </button>
                <button
                  type="button"
                  aria-label={t("mainScreen.ignoreLabel", { label: row.label })}
                  onClick={() => void ignoreToken(processId)}
                  className={cn(actionClassName, "text-warning hover:text-warning")}
                >
                  {t("mainScreen.ignore")}
                </button>
              </>
            ) : (
              <>
                {hidden && processId !== undefined ? (
                  <button
                    type="button"
                    aria-label={t("mainScreen.ignoreLabel", { label: row.label })}
                    onClick={() => {
                      setIgnoreFailed(false);
                      setConfirming(processId, true);
                    }}
                    className={actionClassName}
                  >
                    {t("mainScreen.ignore")}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={t(hidden ? "mainScreen.showLabel" : "mainScreen.hideLabel", { label: row.label })}
                  onClick={() => toggleRowHidden(row)}
                  className={actionClassName}
                >
                  {hidden ? t("mainScreen.show") : t("mainScreen.hide")}
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  };
  const addTokenRow = hiddenExpanded ? (
    <button
      type="button"
      onClick={onAddToken}
      className="flex w-full items-center gap-2.5 rounded-lg px-3.5 py-3 text-left hover:bg-hover phone:-mx-3 phone:w-[calc(100%+1.5rem)] phone:gap-3 phone:px-3 phone:py-3.5 phone:active:bg-hover"
    >
      <span aria-hidden="true" className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-lg border border-line bg-background text-foreground">
        <PlusIcon />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-label font-semibold text-foreground">{t("mainScreen.addToken")}</span>
        <span className="text-caption text-muted">{t("mainScreen.addTokenHint")}</span>
      </span>
      <span aria-hidden="true" className="gleam-chevron flex-shrink-0 text-faint">
        <ChevronRightIcon />
      </span>
    </button>
  ) : null;
  return (
    <div className="min-h-60 phone:min-h-0">
    <>
      {rows.filter((row) => !isRowHidden(row)).map(renderRow)}
      {hiddenRows.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={hiddenExpanded}
            onClick={toggleHiddenExpanded}
            className="flex w-full items-center justify-between px-3.5 py-3 text-label text-muted hover:text-foreground phone:min-h-11 phone:px-0"
          >
            <span>{t("mainScreen.hiddenCount", { count: hiddenRows.length })}</span>
            <ChevronIcon open={hiddenExpanded} />
          </button>
          {hiddenExpanded && ignoreFailed ? (
            <InlineError className="px-3.5 pb-2 phone:px-0">
              {t("mainScreen.ignoreFailed")}
            </InlineError>
          ) : hiddenExpanded && confirmingIgnore.size > 0 ? (
            <p className="px-3.5 pb-2 text-caption text-muted phone:px-0">{t("mainScreen.ignoreHint")}</p>
          ) : null}
          {hiddenExpanded ? hiddenRows.map(renderRow) : null}
          {addTokenRow}
        </>
      ) : listDocked || hiddenExpanded ? (
        // With nothing hidden there's no accordion to open, so this is the way into Show/Hide.
        <>
          {addTokenRow}
          <button
            type="button"
            onClick={() => setHiddenExpanded((prev) => !prev)}
            className={`px-3.5 py-3 text-caption text-muted hover:text-foreground phone:flex phone:min-h-11 phone:items-center phone:px-0 phone:text-label ${hiddenExpanded ? "ml-auto block w-fit" : ""}`}
          >
            {hiddenExpanded ? t("mainScreen.done") : t("mainScreen.editList")}
          </button>
        </>
      ) : null}
    </>
    </div>
  );
}
