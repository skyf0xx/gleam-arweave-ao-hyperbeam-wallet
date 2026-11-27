import type { ReactNode } from "react";
import { explorerUrlFor, type RuntimePort, type TokenBalance } from "@gleam/core";
import { TokenGlyph } from "@gleam/ui/src/components/wallet/index.ts";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { formatTokenAmount } from "../../main-screen/src/formatTokenAmount";
import { displayTicker } from "../../main-screen/src/formatWinston";
import { useLocale, useT } from "../../../i18n";
import { useArTotalSupply } from "./useArTotalSupply";
import { useCopy } from "@gleam/ui/src/primitives/use-copy.ts";
import { CopyButton } from "@gleam/ui/src/primitives/copy-button.tsx";

/**
 * The send screen's Info tab. A detail the token doesn't publish is left
 * out rather than shown as a dash.
 */
export function TokenInfoPanel({
  runtime,
  token,
  priceDisplay,
  chart,
}: {
  runtime: RuntimePort;
  token: TokenBalance | null;
  priceDisplay: string | undefined;
  /** The price chart, or nothing for a token without a price history. */
  chart?: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const denomination = token === null ? 12 : token.denomination;
  const arTotalSupply = useArTotalSupply(runtime, token === null);
  // An unavailable row's decimals can't be trusted to scale the supply.
  const totalSupply = token === null ? arTotalSupply.data : token.available !== false ? token.totalSupply : undefined;

  return (
    <div className="flex flex-col gap-6">
      {chart}

      {token?.description !== undefined ? (
        <p dir="auto" className="whitespace-pre-line break-words text-label text-muted">
          {token.description}
        </p>
      ) : null}

      <dl className="flex flex-col gap-3">
        {/* The chart's figure is the price; the row stands in for a token without one. */}
        {priceDisplay !== undefined && !chart ? <InfoRow label={t("send.price")}>{priceDisplay}</InfoRow> : null}
        <InfoRow label={t("send.decimals")}>{denomination}</InfoRow>
        {totalSupply !== undefined ? (
          <InfoRow label={t("send.totalSupply")}>{formatTokenAmount(totalSupply, denomination, locale)}</InfoRow>
        ) : null}
        {token !== null ? (
          <InfoRow label={t("send.process")}>
            {/* On a phone the two 44px tap areas sit side by side rather than overlapping. */}
            <span className="flex items-center justify-end gap-0.5 phone:gap-6">
              <ProcessId processId={token.processId} />
              <ExplorerLink processId={token.processId} />
            </span>
          </InfoRow>
        ) : null}
      </dl>

    </div>
  );
}

/** The details screen's header title: the token's name, with its ticker quieter beside it when the two differ. */
/** The details screen's title: the token's logo, small, beside its name, so the logo belongs to the name. */
export function TokenHeaderTitle({
  token,
  logoUrl,
}: {
  token: TokenBalance | null;
  /** Already filtered by the Token logos setting and the token's Show/Hide choice. */
  logoUrl: string | undefined;
}) {
  const ticker = token === null ? "AR" : displayTicker(token.ticker);
  const name = token === null ? "Arweave" : (token.name ?? ticker);
  return (
    <span className="flex min-w-0 max-w-full items-center gap-2">
      {/* Bare on the header: the plate behind a logo is for rows. */}
      <TokenGlyph
        label={token === null ? "AR" : ticker.slice(0, 2).toUpperCase()}
        tone={token === null ? 1 : 2}
        logoUrl={logoUrl}
        className={`h-5 w-5 flex-shrink-0 rounded-md text-micro ${logoUrl ? "bg-transparent layered:p-0" : ""}`}
      />
      <span className="flex min-w-0 items-baseline gap-1.5">
        {/* eslint-disable-next-line gleam/type-scale -- matches ScreenHeader's 16px phone title. */}
        <span className="truncate text-body font-semibold text-foreground phone:text-[1rem]">{name}</span>
        {ticker !== name ? <span className="flex-shrink-0 text-label text-muted">{ticker}</span> : null}
      </span>
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

/** The id reads as plain text; copying and the explorer each get their own icon, so neither is a guess. */
function ProcessId({ processId }: { processId: string }) {
  const t = useT();
  const { copied, copy } = useCopy(processId);
  return (
    <>
      <span title={processId} className="mr-1 font-mono text-caption font-medium text-foreground">
        {truncateAddress(processId, 6)}
      </span>
      <CopyButton
        copied={copied}
        onCopy={copy}
        label={copied ? t("send.processIdCopied") : t("send.copyProcessId")}
        title={t("send.copyProcessId")}
        className="rounded p-1 text-muted hover:bg-hover hover:text-foreground phone:hit-target"
      />
    </>
  );
}

function ExplorerLink({ processId }: { processId: string }) {
  const t = useT();
  return (
    <a
      href={explorerUrlFor(processId)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("send.viewOnExplorer")}
      title={t("send.viewOnExplorer")}
      className="rounded p-1 text-muted hover:bg-hover hover:text-foreground phone:hit-target"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
