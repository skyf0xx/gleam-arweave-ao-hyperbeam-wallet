import type { ReactNode } from "react";
import { explorerUrlFor, type TokenBalance } from "@gleam/core";
import { TokenGlyph } from "@gleam/ui/src/components/wallet/index.ts";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { displayTicker } from "../../main-screen/src/formatWinston";
import { useCopy } from "../../points/src/useCopy";

/** AR is native and has no process page, so it links to the network's transactions. */
const AR_EXPLORER_URL = "https://lunar.arweave.net/#/transactions/";

/**
 * The send screen's Info tab. A detail the token doesn't publish is left
 * out rather than shown as a dash.
 */
export function TokenInfoPanel({
  token,
  balanceDisplay,
  balanceValue,
  priceDisplay,
}: {
  token: TokenBalance | null;
  balanceDisplay: string | undefined;
  /** The balance in the display currency, already formatted. */
  balanceValue: string | undefined;
  priceDisplay: string | undefined;
}) {
  const ticker = token === null ? "AR" : displayTicker(token.ticker);
  const name = token === null ? "Arweave" : (token.name ?? ticker);
  const denomination = token === null ? 12 : token.denomination;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <TokenGlyph
          label={token === null ? "AR" : ticker.slice(0, 2).toUpperCase()}
          tone={token === null ? 1 : 2}
          logoUrl={token?.logoUrl}
          className="h-10 w-10 text-label"
        />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-body font-semibold text-foreground">{name}</span>
          <span className="text-label text-muted">{ticker}</span>
        </div>
      </div>

      <dl className="flex flex-col gap-3">
        {balanceDisplay !== undefined ? (
          <InfoRow label="Your balance">
            {balanceDisplay} {ticker}
            {balanceValue !== undefined ? <span className="ml-1.5 font-normal text-muted">≈ {balanceValue}</span> : null}
          </InfoRow>
        ) : null}
        {priceDisplay !== undefined ? <InfoRow label="Price">{priceDisplay}</InfoRow> : null}
        <InfoRow label="Decimals">{denomination}</InfoRow>
        {token !== null ? (
          <InfoRow label="Process">
            <ProcessId processId={token.processId} />
          </InfoRow>
        ) : null}
      </dl>

      <a
        href={token === null ? AR_EXPLORER_URL : explorerUrlFor(token.processId)}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start text-label font-semibold text-foreground hover:underline"
      >
        View on explorer ↗
      </a>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-label">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-semibold tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

function ProcessId({ processId }: { processId: string }) {
  const { copied, copy } = useCopy(processId);
  return (
    <button
      type="button"
      onClick={copy}
      title={processId}
      aria-label={copied ? "Process id copied" : "Copy process id"}
      className="rounded px-1 font-mono text-caption font-medium text-foreground hover:bg-mist"
    >
      {copied ? "Copied" : truncateAddress(processId, 6)}
    </button>
  );
}
