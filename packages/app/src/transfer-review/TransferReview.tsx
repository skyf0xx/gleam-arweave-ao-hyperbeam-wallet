import { Fragment, useState, type ReactNode } from "react";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import {
  AccountAvatar,
  CollectibleThumbnail,
  MemorableAddress,
  RecipientWarning,
  TokenGlyph,
} from "@gleam/ui/src/components/wallet/index.ts";
import { useAddressIdentity } from "../address-identity";
import { useT } from "../i18n";
import { UntrustedText } from "../approval/UntrustedText";
import { DataItemCard } from "./DataItemCard";
import {
  amountText,
  balanceAfterParts,
  feeFiatText,
  feeText,
  fiatText,
  glyphLabel,
  groupDigits,
  isUnknownScale,
  logoFor,
  methodText,
  showsRisk,
  showsWarning,
  totalFiatText,
  unitText,
  warningReasons,
  type BalanceAfterPart,
  type RecipientRisk,
  type SignedPart,
  type TransferContext,
  type TransferLine,
  type TransferRequest,
} from "./model";
import { CopyIcon } from "@gleam/ui/src/primitives/copy-icons.tsx";

export interface TransferReviewProps {
  /** `RequestHeader` in an approval, the screen's own back header on Send. */
  header: ReactNode;
  /** Above the hero, such as the hardware wallet's "Confirm on your device" strip. */
  banner?: ReactNode;
  request: TransferRequest;
  /** The signing wallet. */
  from: { name: string | null; address: string } | null;
  /** A saved contact's or own wallet's name for the recipient. */
  toName?: string | null;
  context: TransferContext;
  /** `null` once the recipient has been accepted, as on a device step. */
  risk: RecipientRisk | null;
  /** Errors, status lines or a device panel, between the summary and the buttons. */
  children?: ReactNode;
  /** Gets whether the warning box shows, which makes the primary action destructive. */
  footer: (warned: boolean) => ReactNode;
}

const GUTTER = "px-6 phone:px-5";

/**
 * Every value-moving request in one layout and one order: who asks, the
 * amount, from and to, the token, fee and balance after, then the raw
 * details. Addresses are shown in full; the token is named by its id
 * as well as its self-chosen ticker. The warning box shows for a
 * first-time or lookalike recipient, for a token with no stated scale and
 * for a token transfer the wallet couldn't read, and only then is the
 * primary action red. That last case opens Details and the tags, since
 * the tags are what the token acts on.
 */
export function TransferReview({
  header,
  banner,
  request,
  from,
  toName,
  context,
  risk,
  children,
  footer,
}: TransferReviewProps) {
  const t = useT();
  const identity = useAddressIdentity();
  const noticed = showsWarning(request, risk);
  const warned = showsRisk(request, risk);
  const batch = request.transfers.length > 1 || request.others.length > 0;
  const first = request.transfers[0]!;
  const balanceAfter = balanceAfterParts(context, request);
  const lookalikeOf = risk?.lookalikeOf ?? null;

  const warning = noticed ? (
    <div className={`${GUTTER} pt-4`}>
      <RecipientWarning
        firstTime={risk?.firstTime ?? false}
        recipient={first.recipient}
        tone={warned ? "risk" : "caution"}
        lookalikeOf={lookalikeOf}
        lookalikeAvatarSvg={lookalikeOf ? identity.avatarSvg(lookalikeOf) : undefined}
        emphasisPick={identity.emphasisPick}
        extraReasons={warningReasons(request, t)}
      />
    </div>
  ) : null;

  return (
    <div className="flex min-h-full flex-col">
      {header}
      {banner ? <div className={`${GUTTER} pt-5`}>{banner}</div> : null}

      {batch ? (
        <>
          <BatchHero request={request} context={context} />
          <div className={`flex flex-col gap-3 ${GUTTER}`}>
            {/* Signing order, so a card's position matches its item number in Details. */}
            {[
              ...request.transfers.map((transfer) => ({
                index: transfer.index,
                node: <TransferCard key={`t${transfer.index}`} transfer={transfer} context={context} />,
              })),
              ...request.others.map((item) => ({
                index: item.index,
                node: <DataItemCard key={`d${item.index}`} index={item.index} item={item} />,
              })),
            ]
              .sort((a, b) => a.index - b.index)
              .map((entry) => entry.node)}
          </div>
          {warning}
          <div className={`flex flex-col gap-3.5 pt-6 ${GUTTER}`}>
            {from ? <SummaryRow label={t("transferReview.from")} value={<FromValue from={from} />} /> : null}
            <SummaryRow label={t("transferReview.networkFee")} value={<FeeValue fee={request.fee} context={context} />} />
            {balanceAfter !== undefined ? <SummaryRow label={t("transferReview.balanceAfter")} value={<BalanceAfter parts={balanceAfter} />} /> : null}
          </div>
        </>
      ) : (
        <>
          <Hero transfer={first} context={context} />
          <Parties from={from} to={first.recipient} toName={toName ?? null} diffAgainst={lookalikeOf ?? undefined} />
          {warning}
          <div className={`flex flex-col gap-3.5 pt-8 ${GUTTER}`}>
            <SummaryRow label={t("transferReview.token")} value={<TokenValue transfer={first} />} />
            <SummaryRow label={t("transferReview.networkFee")} value={<FeeValue fee={request.fee} context={context} />} />
            {balanceAfter !== undefined ? <SummaryRow label={t("transferReview.balanceAfter")} value={<BalanceAfter parts={balanceAfter} />} /> : null}
          </div>
        </>
      )}

      <Details request={request} batch={batch} />

      {children ? <div className={`flex flex-col gap-3 pt-5 ${GUTTER}`}>{children}</div> : null}

      {footer(warned)}
    </div>
  );
}

/** The two-button row at the bottom of a review. */
export function ReviewButtons({
  secondaryLabel,
  onSecondary,
  primaryLabel,
  onPrimary,
  warned,
  busy = false,
  className,
}: {
  secondaryLabel: string;
  onSecondary: () => void;
  primaryLabel?: string;
  onPrimary?: () => void;
  warned: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("mt-auto grid gap-3 pb-6 pt-5", primaryLabel ? "grid-cols-2" : "grid-cols-1", GUTTER, className)}>
      <Button type="button" variant="secondary" onClick={onSecondary} className="h-12">
        {secondaryLabel}
      </Button>
      {primaryLabel && onPrimary ? (
        <Button
          type="button"
          variant={warned ? "destructive" : "primary"}
          disabled={busy}
          aria-busy={busy}
          onClick={onPrimary}
          className="h-12"
        >
          {primaryLabel}
        </Button>
      ) : null}
    </div>
  );
}

function Glyph({ transfer, context, size }: { transfer: TransferLine; context: TransferContext; size: "hero" | "card" }) {
  return (
    <TokenGlyph
      label={glyphLabel(transfer)}
      tone={glyphLabel(transfer) === "?" ? 4 : 1}
      logoUrl={logoFor(transfer, context)}
      className={size === "hero" ? "h-11 w-11 rounded-full text-label" : "h-8 w-8 rounded-full text-caption"}
    />
  );
}

function Hero({ transfer, context }: { transfer: TransferLine; context: TransferContext }) {
  const t = useT();
  if (transfer.collectible) {
    const name = transfer.collectible.name ?? truncateAddress(transfer.collectible.id, 6);
    return (
      <div className={`flex flex-col items-center gap-3 pb-8 pt-8 text-center ${GUTTER}`}>
        <CollectibleThumbnail name={name} imageUrl={transfer.collectible.imageUrl} decorative className="w-40 rounded-[14px]" />
        <div className="flex flex-col items-center gap-0.5">
          <span className="break-words text-h3 font-semibold text-foreground"><UntrustedText text={name} /></span>
          <span className="text-label text-muted">{t("transferReview.oneItem")}</span>
          <OtherTags transfer={transfer} />
        </div>
      </div>
    );
  }
  const fiat = fiatText(context, transfer);
  return (
    <div className={`flex flex-col items-center gap-2.5 pb-8 pt-9 text-center ${GUTTER}`}>
      <Glyph transfer={transfer} context={context} size="hero" />
      {isUnknownScale(transfer) ? (
        <div className="flex max-w-full flex-col items-center gap-1">
          <span dir="ltr" className="font-mono text-display-sm font-medium leading-tight tracking-[-0.02em] tabular-nums text-foreground [overflow-wrap:anywhere]">
            {amountText(transfer)}
          </span>
          <span className="text-body text-muted"><UntrustedText text={unitText(transfer, t)} /></span>
        </div>
      ) : (
        <div className="flex max-w-full flex-col items-center gap-1">
          <div className="flex max-w-full flex-wrap items-baseline justify-center gap-x-2">
            <span className="text-display-lg font-semibold leading-[1.1] tracking-[-0.03em] tabular-nums text-foreground [overflow-wrap:anywhere]">
              {amountText(transfer)}
            </span>
            <span className="text-h3 font-semibold text-muted"><UntrustedText text={unitText(transfer, t)} /></span>
          </div>
          {fiat ? <span className="text-body tabular-nums text-muted">{fiat}</span> : null}
        </div>
      )}
      <OtherTags transfer={transfer} />
    </div>
  );
}

/** The signed tags the headline didn't read, counted where the amount is; Details lists them. */
function OtherTags({ transfer }: { transfer: TransferLine }) {
  const t = useT();
  if (!transfer.otherTags) return null;
  return <span className="text-label font-medium text-foreground">{t("transferReview.otherTags", { count: transfer.otherTags })}</span>;
}

function BatchHero({ request, context }: { request: TransferRequest; context: TransferContext }) {
  const t = useT();
  const total = totalFiatText(context, request.transfers);
  if (total === undefined) return <div className="pt-6" />;
  return (
    <div className={`flex flex-col items-center gap-1 pb-7 pt-8 text-center ${GUTTER}`}>
      <span className="text-display-lg font-semibold leading-[1.1] tracking-[-0.03em] tabular-nums text-foreground">{total}</span>
      <span className="text-body text-muted">{t("transferReview.totalValue")}</span>
    </div>
  );
}

function TransferCard({ transfer, context }: { transfer: TransferLine; context: TransferContext }) {
  const t = useT();
  const identity = useAddressIdentity();
  const fiat = fiatText(context, transfer);
  return (
    <div className="flex flex-col gap-3.5 rounded-xl bg-mist p-4">
      <div className="flex items-center gap-3">
        <Glyph transfer={transfer} context={context} size="card" />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
          <span
            dir="ltr"
            className={`font-semibold tracking-[-0.02em] tabular-nums text-foreground [overflow-wrap:anywhere] ${isUnknownScale(transfer) ? "font-mono text-body" : "text-xl"}`}
          >
            {amountText(transfer)}
          </span>
          <span className="text-body font-semibold text-muted"><UntrustedText text={unitText(transfer, t)} /></span>
        </div>
        {fiat ? <span className="flex-shrink-0 text-label tabular-nums text-muted">{fiat}</span> : null}
      </div>
      <OtherTags transfer={transfer} />
      <div className="grid grid-cols-[32px_minmax(0,1fr)] items-start gap-x-3">
        <span aria-hidden="true" className="mt-[18px] justify-self-center">
          <AccountAvatar svgMarkup={identity.avatarSvg(transfer.recipient)} label="" size={24} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-label text-muted">{t("transferReview.to")}</span>
          <MemorableAddress address={transfer.recipient} emphasisPick={identity.emphasisPick} tone="confirm" />
        </div>
      </div>
      {/* The ticker and scale come from untrusted metadata, so the process
          and raw units sit on the card, not only behind Details. */}
      {transfer.token !== null ? (
        <div className="flex flex-col gap-1.5">
          <SummaryRow label={t("transferReview.token")} value={<TokenValue transfer={transfer} />} />
          {transfer.collectible || isUnknownScale(transfer) ? null : (
            <SummaryRow
              label={t("transferReview.rawUnitsLabel")}
              value={
                <span dir="ltr" className="font-mono text-caption">
                  {groupDigits(transfer.amount)}
                </span>
              }
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function Parties({
  from,
  to,
  toName,
  diffAgainst,
}: {
  from: TransferReviewProps["from"];
  to: string;
  toName: string | null;
  diffAgainst?: string;
}) {
  const t = useT();
  const identity = useAddressIdentity();
  return (
    <div className={`grid grid-cols-[36px_minmax(0,1fr)] gap-x-3.5 ${GUTTER}`}>
      {from ? (
        <>
          <AccountAvatar svgMarkup={identity.avatarSvg(from.address)} label="" size={36} />
          <div className="flex min-w-0 flex-col justify-center">
            <span className="text-label text-muted">{t("transferReview.from")}</span>
            <FromValue from={from} />
          </div>
          <svg
            aria-hidden="true"
            viewBox="0 0 12 28"
            className="my-2.5 h-7 w-3 justify-self-center text-muted/60"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 1v25M1.5 21.5 6 26l4.5-4.5" />
          </svg>
          <div />
        </>
      ) : null}
      <AccountAvatar svgMarkup={identity.avatarSvg(to)} label="" size={36} />
      <div className="flex min-w-0 flex-col">
        <span className="text-label text-muted">{t("transferReview.to")}</span>
        {toName ? <span className="break-words text-body font-medium text-foreground">{toName}</span> : null}
        <MemorableAddress address={to} emphasisPick={identity.emphasisPick} tone="confirm" diffAgainst={diffAgainst} />
      </div>
    </div>
  );
}

function FeeValue({ fee, context }: { fee: string | null; context: TransferContext }) {
  const t = useT();
  const fiat = feeFiatText(fee, context);
  return (
    <>
      {feeText(fee, t)}
      {fiat ? <span className="ml-1.5 text-muted">{fiat}</span> : null}
    </>
  );
}

function FromValue({ from }: { from: { name: string | null; address: string } }) {
  return (
    <span className="min-w-0 break-words text-body font-medium text-foreground">
      {from.name ? <>{from.name} </> : null}
      <span dir="ltr" className="font-mono text-caption font-normal text-muted">
        {truncateAddress(from.address, 4)}
      </span>
    </span>
  );
}

function TokenValue({ transfer }: { transfer: TransferLine }) {
  const t = useT();
  if (transfer.token === null) return <>AR</>;
  if (transfer.collectible || isUnknownScale(transfer)) {
    return (
      <span dir="ltr" className="block max-w-[13.5rem] break-all text-right font-mono text-label leading-snug text-foreground">
        {transfer.collectible ? truncateAddress(transfer.token, 6) : transfer.token}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-medium"><UntrustedText text={unitText(transfer, t)} /></span>
      <span dir="ltr" className="font-mono text-caption text-muted">
        {truncateAddress(transfer.token, 6)}
      </span>
    </span>
  );
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-6 items-center justify-between gap-4 text-body">
      <span className="flex-shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-right tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function BalanceAfter({ parts }: { parts: BalanceAfterPart[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? " · " : null}
          {part.amount}
          {part.ticker !== null ? <> <UntrustedText text={part.ticker} /></> : null}
        </Fragment>
      ))}
    </>
  );
}

function Details({ request, batch }: { request: TransferRequest; batch: boolean }) {
  const t = useT();
  const showTags = request.unreadableTokenTransfer === true;
  const [open, setOpen] = useState(showTags);
  const first = request.transfers[0]!;
  const method = methodText(request, t);
  const count = t("transferReview.itemsCount", { count: request.itemCount });
  const summary = batch ? (method ? `${method} · ${count}` : count) : groupDigits(first.amount);

  return (
    <div className={`pt-6 ${GUTTER}`}>
      <div className="rounded-xl bg-mist">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-4 text-left text-body font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          <span>{t("transferReview.details")}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span dir="ltr" className="truncate font-mono text-caption font-normal tabular-nums text-muted">
              {summary}
            </span>
            <ChevronIcon open={open} />
          </span>
        </button>
        {open ? (
          <div className="flex flex-col gap-3 px-4 pb-4">
            {method ? <DetailRow label={t("transferReview.method")} value={method} /> : null}
            {batch
              ? request.transfers.map((transfer) => (
                  <div key={transfer.index} className="flex flex-col gap-3 pt-2">
                    <span className="text-label font-semibold text-foreground">
                      {t("transferReview.itemNumber", { number: transfer.index + 1 })}
                    </span>
                    <TransferDetails transfer={transfer} part={transfer.part} showTags={showTags} />
                  </div>
                ))
              : <TransferDetails transfer={first} part={first.part} showTags={showTags} />}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TransferDetails({ transfer, part, showTags }: { transfer: TransferLine; part: SignedPart; showTags: boolean }) {
  const t = useT();
  const [tagsOpen, setTagsOpen] = useState(showTags);
  return (
    <>
      <DetailRow label={t("transferReview.rawUnitsLabel")} value={groupDigits(transfer.amount)} />
      {transfer.token !== null ? (
        <DetailRow
          label={transfer.collectible ? t("transferReview.collectible") : t("transferReview.process")}
          value={transfer.token}
        />
      ) : null}
      {part.tags.length > 0 ? (
        <>
          <button
            type="button"
            aria-expanded={tagsOpen}
            onClick={() => setTagsOpen((current) => !current)}
            className="min-h-6 self-start text-label font-medium text-foreground underline underline-offset-[3px] phone:hit-target"
          >
            {tagsOpen ? t("transferReview.hideTags") : t("transferReview.viewAllTags", { count: part.tags.length })}
          </button>
          {tagsOpen ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {part.tags.map((tag, index) => (
                <li key={index} className="break-all font-mono text-caption leading-snug text-foreground">
                  <span className="text-muted">
                    <UntrustedText text={tag.name} />:
                  </span>{" "}
                  <UntrustedText text={tag.value} />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {part.decodedData !== null && part.decodedData !== "" ? (
        <div className="flex flex-col gap-1">
          <span className="text-label text-muted">{t("transferReview.decodedData")}</span>
          <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-mono text-caption leading-relaxed text-foreground">
            <UntrustedText text={part.decodedData} />
          </div>
        </div>
      ) : null}
      {part.payloadHash !== null ? <PayloadHash value={part.payloadHash} /> : null}
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="flex-shrink-0 text-label text-muted">{label}</span>
      <span dir="ltr" className="min-w-0 break-all text-right font-mono text-caption leading-snug tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}

function PayloadHash({ value }: { value: string }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label text-muted">{t("transferReview.payloadHash")}</span>
      <div className="flex items-start gap-2">
        <span dir="ltr" className="flex-1 break-all font-mono text-caption leading-relaxed text-foreground">
          {value}
        </span>
        <button
          type="button"
          aria-label={t("transferReview.copyPayloadHash")}
          onClick={() => void copyToClipboard(value)}
          className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md text-faint hover:bg-background hover:text-muted phone:hit-target"
        >
          <CopyIcon />
        </button>
      </div>
    </div>
  );
}

async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // The value is still on screen and selectable.
  }
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`flex-shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** The hardware wallet's strip above a review once it waits for the device. */
export function DeviceBanner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-mist px-4 py-3.5">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0 text-foreground">
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M10 6h4" />
        <circle cx="12" cy="16" r="2" />
      </svg>
      <span className="flex-1 text-body font-semibold text-foreground">{text}</span>
      <span aria-hidden="true" className="h-2 w-2 flex-shrink-0 rounded-full bg-beam-sky" />
    </div>
  );
}
