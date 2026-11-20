import type { ReactNode } from "react";
import { explorerUrlFor, type TokenBalance } from "@gleam/core";
import { TokenGlyph } from "@gleam/ui/src/components/wallet/index.ts";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { displayTicker } from "../../main-screen/src/formatWinston";
import { useT } from "../../../i18n";
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
  chart,
}: {
  token: TokenBalance | null;
  balanceDisplay: string | undefined;
  /** The balance in the display currency, already formatted. */
  balanceValue: string | undefined;
  priceDisplay: string | undefined;
  /** The price chart, or nothing for a token without a price history. */
  chart?: ReactNode;
}) {
  const t = useT();
  const ticker = token === null ? "AR" : displayTicker(token.ticker);
  const denomination = token === null ? 12 : token.denomination;

  return (
    <div className="flex flex-col gap-6">
      {chart}

      <dl className="flex flex-col gap-3">
        {balanceDisplay !== undefined ? (
          <InfoRow label={t("send.yourBalance")}>
            {balanceDisplay} {ticker}
            {balanceValue !== undefined ? <span className="ml-1.5 font-normal text-muted">≈ {balanceValue}</span> : null}
          </InfoRow>
        ) : null}
        {priceDisplay !== undefined ? <InfoRow label={t("send.price")}>{priceDisplay}</InfoRow> : null}
        <InfoRow label={t("send.decimals")}>{denomination}</InfoRow>
        {token !== null ? (
          <InfoRow label={t("send.process")}>
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
        {t("send.viewOnExplorer")}
      </a>
    </div>
  );
}

/** The details screen's header title: the token's name, with its ticker quieter beside it when the two differ. */
export function TokenHeaderTitle({ token }: { token: TokenBalance | null }) {
  const ticker = token === null ? "AR" : displayTicker(token.ticker);
  const name = token === null ? "Arweave" : (token.name ?? ticker);
  return (
    <span className="flex min-w-0 max-w-full items-baseline gap-1.5">
      {/* eslint-disable-next-line gleam/type-scale -- matches ScreenHeader's 16px phone title. */}
      <span className="truncate text-body font-semibold text-foreground phone:text-[1rem]">{name}</span>
      {ticker !== name ? <span className="flex-shrink-0 text-label text-muted">{ticker}</span> : null}
    </span>
  );
}

/** The token's logo for the details screen's header. */
export function TokenHeaderGlyph({
  token,
  logoUrl,
}: {
  token: TokenBalance | null;
  /** Already filtered by the Token logos setting and the token's Show/Hide choice. */
  logoUrl: string | undefined;
}) {
  const ticker = token === null ? "AR" : displayTicker(token.ticker);
  return (
    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center phone:h-11 phone:w-11">
      <TokenGlyph label={token === null ? "AR" : ticker.slice(0, 2).toUpperCase()} tone={token === null ? 1 : 2} logoUrl={logoUrl} className="h-8 w-8 text-caption" />
    </span>
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
  const t = useT();
  const { copied, copy } = useCopy(processId);
  return (
    <button
      type="button"
      onClick={copy}
      title={processId}
      aria-label={copied ? t("send.processIdCopied") : t("send.copyProcessId")}
      className="rounded px-1 font-mono text-caption font-medium text-foreground hover:bg-hover"
    >
      {copied ? t("send.copied") : truncateAddress(processId, 6)}
    </button>
  );
}
